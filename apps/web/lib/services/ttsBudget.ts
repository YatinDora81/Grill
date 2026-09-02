import "server-only";
import { config } from "@/lib/env";
import { getRedis } from "@/lib/redis";

const REDIS_PREFIX = "grill:tts:";

const KEY_TTL_S = 172_800;

const REDIS_TIMEOUT_MS = 1_500;

const WARN_INTERVAL_MS = 60_000;
let warnedAt = 0;

export type TtsLane = "orpheus" | "gemini";

interface LaneCount {
  day: string;
  spent: number;
}

const local = new Map<TtsLane, LaneCount>();

export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function budgetFor(lane: TtsLane): number {
  return lane === "gemini" ? config.tts.geminiDailyBudget : config.tts.dailyBudget;
}

function redisKey(lane: TtsLane, day: string): string {
  return lane === "orpheus" ? `${REDIS_PREFIX}${day}` : `${REDIS_PREFIX}${lane}:${day}`;
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

function laneCount(lane: TtsLane, day: string): LaneCount {
  const existing = local.get(lane);
  if (existing && existing.day === day) return existing;
  const fresh = { day, spent: 0 };
  local.set(lane, fresh);
  return fresh;
}

function localConsume(lane: TtsLane, day: string, budget: number): boolean {
  const count = laneCount(lane, day);
  if (count.spent >= budget) return false;
  count.spent++;
  return true;
}

export async function tryConsume(
  now: Date = new Date(),
  lane: TtsLane = "orpheus",
): Promise<boolean> {
  const budget = budgetFor(lane);
  if (budget <= 0) return false;

  const day = dayKey(now);
  const redis = getRedis();

  if (redis) {
    const key = redisKey(lane, day);
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

  return localConsume(lane, day, budget);
}

export async function remaining(
  now: Date = new Date(),
  lane: TtsLane = "orpheus",
): Promise<number> {
  const budget = budgetFor(lane);
  if (budget <= 0) return 0;

  const day = dayKey(now);
  const redis = getRedis();

  if (redis) {
    try {
      const used = await withTimeout(redis.get<number>(redisKey(lane, day)), "tts budget read");
      return Math.max(0, budget - (Number(used) || 0));
    } catch (err) {
      warnRedisDown(err);
    }
  }

  const count = local.get(lane);
  return Math.max(0, budget - (count?.day === day ? count.spent : 0));
}

export function resetLocalBudget(): void {
  local.clear();
}
