import "server-only";
import { config } from "@/lib/env";
import { getRedis } from "@/lib/redis";

const REDIS_PREFIX = "grill:tts:";

const KEY_TTL_S = 172_800;

const REDIS_TIMEOUT_MS = 1_500;

const WARN_INTERVAL_MS = 60_000;
let warnedAt = 0;

let localDay = "";
let localSpent = 0;

export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function warnRedisDown(err: unknown): void {
  const now = Date.now();
  if (now - warnedAt < WARN_INTERVAL_MS) return;
  warnedAt = now;
  console.warn(
    "[ttsBudget] redis unavailable; using the per-instance counter:",
    err instanceof Error ? err.message : err,
  );
}

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

function localConsume(day: string, budget: number): boolean {
  if (localDay !== day) {
    localDay = day;
    localSpent = 0;
  }
  if (localSpent >= budget) return false;
  localSpent++;
  return true;
}

export async function tryConsume(now: Date = new Date()): Promise<boolean> {
  const budget = config.tts.dailyBudget;
  if (budget <= 0) return false;

  const day = dayKey(now);
  const redis = getRedis();

  if (redis) {
    const key = `${REDIS_PREFIX}${day}`;
    try {
      const pipeline = redis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, KEY_TTL_S);
      const [used] = await withTimeout(pipeline.exec<[number, 0 | 1]>(), "tts budget");

      if (used > budget) {
        await withTimeout(redis.decr(key), "tts budget rollback").catch(() => {});
        return false;
      }
      return true;
    } catch (err) {
      warnRedisDown(err);
    }
  }

  return localConsume(day, budget);
}

export async function remaining(now: Date = new Date()): Promise<number> {
  const budget = config.tts.dailyBudget;
  if (budget <= 0) return 0;

  const day = dayKey(now);
  const redis = getRedis();

  if (redis) {
    try {
      const used = await withTimeout(redis.get<number>(`${REDIS_PREFIX}${day}`), "tts budget read");
      return Math.max(0, budget - (Number(used) || 0));
    } catch (err) {
      warnRedisDown(err);
    }
  }

  return Math.max(0, budget - (localDay === day ? localSpent : 0));
}

export function resetLocalBudget(): void {
  localDay = "";
  localSpent = 0;
}
