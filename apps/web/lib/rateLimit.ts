import "server-only";
import { getRedis, type Redis } from "@/lib/redis";
import { AppError } from "./errors";

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_MS = 60_000;

interface Options {
  limit?: number;
  windowMs?: number;
}

type Entry = { times: number[]; expiresAt: number };

const hits = new Map<string, Entry>();

const MAX_KEYS = 10_000;
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;

export function memoryRateLimit(key: string, opts: Options = {}): void {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const now = Date.now();

  if (now - lastSweep >= SWEEP_INTERVAL_MS) {
    for (const [k, entry] of hits) {
      if (entry.expiresAt <= now) hits.delete(k);
    }
    lastSweep = now;
  }

  const times = (hits.get(key)?.times ?? []).filter((t) => now - t < windowMs);
  if (times.length >= limit) {
    throw new AppError(429, "rate_limited", "Too many attempts. Wait a moment and try again.");
  }
  times.push(now);
  hits.delete(key);
  hits.set(key, { times, expiresAt: now + windowMs });

  while (hits.size > MAX_KEYS) {
    const coldest = hits.keys().next();
    if (coldest.done) break;
    hits.delete(coldest.value);
  }
}

const REDIS_PREFIX = "grill:rl:";

const REDIS_TIMEOUT_MS = 1_500;

const REDIS_WARN_INTERVAL_MS = 60_000;
let redisWarnedAt = 0;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${REDIS_TIMEOUT_MS}ms`)),
      REDIS_TIMEOUT_MS,
    );
  });
  return Promise.race([work, guard]).finally(() => clearTimeout(timer));
}

async function redisRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const now = Date.now();
  const k = `${REDIS_PREFIX}${key}`;
  const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(k, 0, now - windowMs);
  pipeline.zadd(k, { score: now, member });
  pipeline.zcard(k);
  pipeline.pexpire(k, windowMs);

  const [, , used] = await withTimeout(
    pipeline.exec<[number, number | null, number, 0 | 1]>(),
    "rate limit",
  );

  if (used > limit) {
    await withTimeout(redis.zrem(k, member), "rate limit rollback").catch(() => {});
    throw new AppError(429, "rate_limited", "Too many attempts. Wait a moment and try again.");
  }
}

function warnRedisDown(err: unknown): void {
  const now = Date.now();
  if (now - redisWarnedAt < REDIS_WARN_INTERVAL_MS) return;
  redisWarnedAt = now;
  console.warn(
    "[rateLimit] redis unavailable; using the in-memory limiter:",
    err instanceof Error ? err.message : err,
  );
}

export async function rateLimit(key: string, opts: Options = {}): Promise<void> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;

  const redis = getRedis();
  if (redis) {
    try {
      await redisRateLimit(redis, key, limit, windowMs);
      return;
    } catch (err) {
      if (err instanceof AppError) throw err;
      warnRedisDown(err);
    }
  }

  memoryRateLimit(key, { limit, windowMs });
}

export function clientKey(req: Request, bucket: string): string {
  const hops =
    req.headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((hop) => hop.trim())
      .filter(Boolean) ?? [];
  const ip = hops[hops.length - 1] ?? "unknown";
  return `${bucket}:${ip}`;
}
