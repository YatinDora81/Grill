import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));

const envConfig = { upstash: { redisUrl: "", redisToken: "" } };
mock.module("@/lib/env", () => ({ config: envConfig }));

const store = new Map<string, Map<string, number>>();
const members = (key: string) => {
  let s = store.get(key);
  if (!s) store.set(key, (s = new Map()));
  return s;
};

let redisDown = false;
let execCount = 0;
const builtWith: string[] = [];

class FakeRedis {
  constructor(opts: { url: string; token: string }) {
    builtWith.push(opts.url);
  }

  pipeline() {
    const ops: (() => unknown)[] = [];
    const api = {
      zremrangebyscore(key: string, min: number, max: number) {
        ops.push(() => {
          const set = members(key);
          let removed = 0;
          for (const [member, score] of set) {
            if (score >= min && score <= max) {
              set.delete(member);
              removed++;
            }
          }
          return removed;
        });
        return api;
      },
      zadd(key: string, ...entries: { score: number; member: string }[]) {
        ops.push(() => {
          const set = members(key);
          let added = 0;
          for (const entry of entries) {
            if (!set.has(entry.member)) added++;
            set.set(entry.member, entry.score);
          }
          return added;
        });
        return api;
      },
      zcard(key: string) {
        ops.push(() => members(key).size);
        return api;
      },
      pexpire(_key: string, _ms: number) {
        ops.push(() => 1);
        return api;
      },
      async exec() {
        execCount++;
        if (redisDown) throw new Error("fetch failed");
        return ops.map((op) => op());
      },
    };
    return api;
  }

  async zrem(key: string, member: string) {
    return members(key).delete(member) ? 1 : 0;
  }
}

mock.module("@upstash/redis", () => ({ Redis: FakeRedis }));

const { rateLimit, clientKey } = await import("./rateLimit");
const { getRedis } = await import("./redis");
const { AppError } = await import("./errors");

let clock = 1_700_000_000_000;
spyOn(Date, "now").mockImplementation(() => clock);
afterAll(() => mock.restore());

let n = 0;
const freshIp = () => `203.0.113.${(n++ % 250) + 1}.${n}`;
const freshKey = () => `test:${n++}`;

const reqWith = (headers: Record<string, string>) => new Request("https://x.test/", { headers });

const expectRefusal = async (work: Promise<void>) => {
  try {
    await work;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as InstanceType<typeof AppError>).status).toBe(429);
    expect((err as InstanceType<typeof AppError>).code).toBe("rate_limited");
    return;
  }
  throw new Error("expected the limiter to refuse");
};

describe("clientKey", () => {
  test("keys on the rightmost forwarded hop, so rotating the leftmost one does not move the bucket", () => {
    const peer = freshIp();
    const a = clientKey(reqWith({ "x-forwarded-for": `10.0.0.1, ${peer}` }), "login");
    const b = clientKey(reqWith({ "x-forwarded-for": `198.51.100.7, 172.16.0.4, ${peer}` }), "login");

    expect(a).toBe(`login:${peer}`);
    expect(b).toBe(a);
  });

  test("gives two real clients distinct buckets even when both send the same forged prefix", () => {
    const one = clientKey(reqWith({ "x-forwarded-for": `10.0.0.1, ${freshIp()}` }), "login");
    const two = clientKey(reqWith({ "x-forwarded-for": `10.0.0.1, ${freshIp()}` }), "login");

    expect(one).not.toBe(two);
  });

  test("ignores x-real-ip when no proxy header is present, rather than trusting it", () => {
    expect(clientKey(reqWith({ "x-real-ip": "9.9.9.9" }), "login")).toBe("login:unknown");
  });

  test("separates buckets by name so one route's spend is not another's", () => {
    const peer = freshIp();
    const headers = { "x-forwarded-for": peer };
    expect(clientKey(reqWith(headers), "login")).not.toBe(clientKey(reqWith(headers), "signup"));
  });
});

describe("rateLimit (in memory, Upstash unset)", () => {
  test("never reaches for Redis when the pair is unset", async () => {
    const before = execCount;
    await rateLimit(freshKey(), { limit: 2, windowMs: 60_000 });

    expect(getRedis()).toBeNull();
    expect(execCount).toBe(before);
  });

  test("still returns a promise, so a caller that forgets the await is catchable", () => {
    const pending = rateLimit(freshKey(), { limit: 2, windowMs: 60_000 });
    expect(pending).toBeInstanceOf(Promise);
    return pending;
  });

  test("a caller rotating the forwarded header cannot buy itself extra attempts", async () => {
    const peer = freshIp();
    const attempt = (forged: string) =>
      rateLimit(clientKey(reqWith({ "x-forwarded-for": `${forged}, ${peer}` }), "login"), {
        limit: 3,
        windowMs: 60_000,
      });

    await attempt("10.0.0.1");
    await attempt("10.0.0.2");
    await attempt("10.0.0.3");

    await expectRefusal(attempt("10.0.0.4"));
  });

  test("trips at the threshold with a 429 and recovers once the window has elapsed", async () => {
    const key = freshKey();
    const opts = { limit: 5, windowMs: 60_000 };

    for (let i = 0; i < 5; i++) await rateLimit(key, opts);
    await expectRefusal(rateLimit(key, opts));

    clock += 59_999;
    await expectRefusal(rateLimit(key, opts));

    clock += 1;
    await rateLimit(key, opts);
  });

  test("holds distinct clients to their own budgets", async () => {
    const spender = freshKey();
    const bystander = freshKey();
    const opts = { limit: 2, windowMs: 60_000 };

    await rateLimit(spender, opts);
    await rateLimit(spender, opts);
    await expectRefusal(rateLimit(spender, opts));

    await rateLimit(bystander, opts);
  });

  test("sheds cold entries under a burst of distinct keys instead of retaining every one", async () => {
    const opts = { limit: 1, windowMs: 600_000 };
    const victim = freshKey();

    await rateLimit(victim, opts);
    await expectRefusal(rateLimit(victim, opts));

    for (let i = 0; i < 10_001; i++) await rateLimit(`burst:${i}`, opts);

    await rateLimit(victim, opts);
  });
});

describe("rateLimit (Redis-backed)", () => {
  beforeEach(() => {
    envConfig.upstash.redisUrl = "https://fake.upstash.io";
    envConfig.upstash.redisToken = "fake-token";
    redisDown = false;
  });

  afterEach(() => {
    envConfig.upstash.redisUrl = "";
    envConfig.upstash.redisToken = "";
    store.clear();
  });

  test("counts in Redis and refuses at the threshold with the same 429", async () => {
    const key = freshKey();
    const opts = { limit: 3, windowMs: 60_000 };
    const before = execCount;

    for (let i = 0; i < 3; i++) await rateLimit(key, opts);
    await expectRefusal(rateLimit(key, opts));

    expect(execCount).toBe(before + 4);
  });

  test("does not let a refused attempt extend its own block", async () => {
    const key = freshKey();
    const opts = { limit: 2, windowMs: 60_000 };

    await rateLimit(key, opts);
    await rateLimit(key, opts);
    await expectRefusal(rateLimit(key, opts));

    expect(members(`grill:rl:${key}`).size).toBe(2);

    clock += 60_000;
    await rateLimit(key, opts);
  });

  test("slides rather than resetting on a fixed boundary", async () => {
    const key = freshKey();
    const opts = { limit: 2, windowMs: 60_000 };

    await rateLimit(key, opts);
    clock += 40_000;
    await rateLimit(key, opts);
    await expectRefusal(rateLimit(key, opts));

    clock += 20_001;
    await rateLimit(key, opts);
    await expectRefusal(rateLimit(key, opts));
  });

  test("namespaces its keys and keeps distinct callers apart", async () => {
    const spender = freshKey();
    const bystander = freshKey();
    const opts = { limit: 1, windowMs: 60_000 };

    await rateLimit(spender, opts);
    await expectRefusal(rateLimit(spender, opts));
    await rateLimit(bystander, opts);

    expect(store.has(`grill:rl:${spender}`)).toBe(true);
    expect(store.has(spender)).toBe(false);
  });

  test("builds one client per URL instead of one per call", async () => {
    const opts = { limit: 5, windowMs: 60_000 };

    await rateLimit(freshKey(), opts);
    await rateLimit(freshKey(), opts);

    expect(builtWith).toEqual(["https://fake.upstash.io"]);
  });

  test("degrades to the in-memory limiter when Redis is unreachable, and says so once", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    redisDown = true;
    const key = freshKey();
    const opts = { limit: 2, windowMs: 60_000 };

    try {
      await rateLimit(key, opts);
      await rateLimit(key, opts);
      expect(warn).toHaveBeenCalledTimes(1);

      await expectRefusal(rateLimit(key, opts));

      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
