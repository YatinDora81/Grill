import { test, expect, mock, beforeEach } from "bun:test";

mock.module("server-only", () => ({}));

const envConfig = { tts: { dailyBudget: 3, geminiDailyBudget: 2 } };
mock.module("@/lib/env", () => ({ config: envConfig }));

const counters = new Map<string, number>();
const expiries = new Map<string, number>();
let redisDown = false;
let redisPresent = false;

const fakeRedis = {
  pipeline() {
    const ops: (() => unknown)[] = [];
    const api = {
      incr(key: string) {
        ops.push(() => {
          const next = (counters.get(key) ?? 0) + 1;
          counters.set(key, next);
          return next;
        });
        return api;
      },
      expire(key: string, seconds: number) {
        ops.push(() => {
          expiries.set(key, seconds);
          return 1;
        });
        return api;
      },
      async exec() {
        if (redisDown) throw new Error("redis unreachable");
        return ops.map((op) => op());
      },
    };
    return api;
  },
  async decr(key: string) {
    const next = (counters.get(key) ?? 0) - 1;
    counters.set(key, next);
    return next;
  },
  async get(key: string) {
    if (redisDown) throw new Error("redis unreachable");
    return counters.get(key) ?? null;
  },
};

mock.module("@/lib/redis", () => ({
  getRedis: () => (redisPresent ? fakeRedis : null),
}));

const { dayKey, remaining, resetLocalBudget, tryConsume } = await import("./ttsBudget");

beforeEach(() => {
  counters.clear();
  expiries.clear();
  redisDown = false;
  redisPresent = false;
  envConfig.tts.dailyBudget = 3;
  envConfig.tts.geminiDailyBudget = 2;
  resetLocalBudget();
});

test("keys the day in UTC, not in whoever is asking's timezone", () => {
  expect(dayKey(new Date("2026-08-26T23:59:59.000Z"))).toBe("2026-08-26");
  expect(dayKey(new Date("2026-08-27T00:00:01.000Z"))).toBe("2026-08-27");
});

test("in-memory: allows exactly the budget and refuses the call after it", async () => {
  expect(await tryConsume()).toBe(true);
  expect(await tryConsume()).toBe(true);
  expect(await tryConsume()).toBe(true);
  expect(await tryConsume()).toBe(false);
  expect(await remaining()).toBe(0);
});

test("in-memory: a new day starts the count over", async () => {
  const today = new Date("2026-08-26T10:00:00.000Z");
  const tomorrow = new Date("2026-08-27T10:00:00.000Z");
  for (let i = 0; i < 3; i++) await tryConsume(today);
  expect(await tryConsume(today)).toBe(false);

  expect(await tryConsume(tomorrow)).toBe(true);
  expect(await remaining(tomorrow)).toBe(2);
});

test("a budget of zero is a switch, not a counter", async () => {
  envConfig.tts.dailyBudget = 0;
  expect(await tryConsume()).toBe(false);
  expect(await remaining()).toBe(0);
});

test("redis: counts against one shared key per day and arms its expiry", async () => {
  redisPresent = true;
  const day = new Date("2026-08-26T10:00:00.000Z");

  expect(await tryConsume(day)).toBe(true);
  expect(await tryConsume(day)).toBe(true);

  expect(counters.get("grill:tts:2026-08-26")).toBe(2);
  expect(expiries.get("grill:tts:2026-08-26")).toBe(172_800);
  expect(await remaining(day)).toBe(1);
});

test("redis: refuses past the budget and hands the refused call back", async () => {
  redisPresent = true;
  const day = new Date("2026-08-26T10:00:00.000Z");

  for (let i = 0; i < 3; i++) expect(await tryConsume(day)).toBe(true);
  expect(await tryConsume(day)).toBe(false);

  expect(counters.get("grill:tts:2026-08-26")).toBe(3);
  expect(await remaining(day)).toBe(0);
});

test("a dead redis degrades to the per-instance counter instead of muting the room", async () => {
  redisPresent = true;
  redisDown = true;

  expect(await tryConsume()).toBe(true);
  expect(await tryConsume()).toBe(true);
  expect(await tryConsume()).toBe(true);
  expect(await tryConsume()).toBe(false);
});

test("remaining answers optimistically when the counter cannot be read", async () => {
  redisPresent = true;
  redisDown = true;

  expect(await remaining()).toBe(3);
});

test("in-memory: each lane spends its own budget, not the other's", async () => {
  const day = new Date("2026-08-26T10:00:00.000Z");

  for (let i = 0; i < 3; i++) expect(await tryConsume(day, "orpheus")).toBe(true);
  expect(await tryConsume(day, "orpheus")).toBe(false);

  expect(await tryConsume(day, "gemini")).toBe(true);
  expect(await tryConsume(day, "gemini")).toBe(true);
  expect(await tryConsume(day, "gemini")).toBe(false);

  expect(await remaining(day, "orpheus")).toBe(0);
  expect(await remaining(day, "gemini")).toBe(0);
});

test("in-memory: a lane's own budget is what limits it", async () => {
  const day = new Date("2026-08-26T10:00:00.000Z");

  expect(await tryConsume(day, "gemini")).toBe(true);

  expect(await remaining(day, "gemini")).toBe(1);
  expect(await remaining(day, "orpheus")).toBe(3);
});

test("redis: orpheus keeps the key it has always had, gemini gets its own", async () => {
  redisPresent = true;
  const day = new Date("2026-08-26T10:00:00.000Z");

  await tryConsume(day, "orpheus");
  await tryConsume(day, "gemini");

  expect(counters.get("grill:tts:2026-08-26")).toBe(1);
  expect(counters.get("grill:tts:gemini:2026-08-26")).toBe(1);
  expect(expiries.get("grill:tts:gemini:2026-08-26")).toBe(172_800);
});

test("redis: a lane refuses past its own budget without touching the other", async () => {
  redisPresent = true;
  const day = new Date("2026-08-26T10:00:00.000Z");

  expect(await tryConsume(day, "gemini")).toBe(true);
  expect(await tryConsume(day, "gemini")).toBe(true);
  expect(await tryConsume(day, "gemini")).toBe(false);

  expect(await remaining(day, "gemini")).toBe(0);
  expect(await remaining(day, "orpheus")).toBe(3);
});

test("a gemini budget of zero keeps the lane shut", async () => {
  envConfig.tts.geminiDailyBudget = 0;

  expect(await tryConsume(new Date(), "gemini")).toBe(false);
  expect(await remaining(new Date(), "gemini")).toBe(0);
  expect(await tryConsume()).toBe(true);
});
