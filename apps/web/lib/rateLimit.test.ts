import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));

const { rateLimit, clientKey } = await import("./rateLimit");
const { AppError } = await import("./errors");

let clock = 1_700_000_000_000;
spyOn(Date, "now").mockImplementation(() => clock);
afterAll(() => mock.restore());

let n = 0;
const freshIp = () => `203.0.113.${(n++ % 250) + 1}.${n}`;
const freshKey = () => `test:${n++}`;

const reqWith = (headers: Record<string, string>) => new Request("https://x.test/", { headers });

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

describe("rateLimit", () => {
  test("a caller rotating the forwarded header cannot buy itself extra attempts", () => {
    // The attack, end to end: same peer, a fresh forged hop on every request.
    const peer = freshIp();
    const attempt = (forged: string) =>
      rateLimit(clientKey(reqWith({ "x-forwarded-for": `${forged}, ${peer}` }), "login"), {
        limit: 3,
        windowMs: 60_000,
      });

    attempt("10.0.0.1");
    attempt("10.0.0.2");
    attempt("10.0.0.3");

    expect(() => attempt("10.0.0.4")).toThrow(AppError);
  });

  test("trips at the threshold with a 429 and recovers once the window has elapsed", () => {
    const key = freshKey();
    const opts = { limit: 5, windowMs: 60_000 };

    for (let i = 0; i < 5; i++) rateLimit(key, opts);
    expect(() => rateLimit(key, opts)).toThrow(AppError);

    try {
      rateLimit(key, opts);
      throw new Error("expected the limiter to refuse");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as InstanceType<typeof AppError>).status).toBe(429);
      expect((err as InstanceType<typeof AppError>).code).toBe("rate_limited");
    }

    clock += 59_999;
    expect(() => rateLimit(key, opts)).toThrow(AppError);

    clock += 1;
    expect(() => rateLimit(key, opts)).not.toThrow();
  });

  test("holds distinct clients to their own budgets", () => {
    const spender = freshKey();
    const bystander = freshKey();
    const opts = { limit: 2, windowMs: 60_000 };

    rateLimit(spender, opts);
    rateLimit(spender, opts);
    expect(() => rateLimit(spender, opts)).toThrow(AppError);

    expect(() => rateLimit(bystander, opts)).not.toThrow();
  });

  // Runs last on purpose: it fills the map to its cap and evicts every key the
  // tests above left behind.
  test("sheds cold entries under a burst of distinct keys instead of retaining every one", () => {
    const opts = { limit: 1, windowMs: 600_000 };
    const victim = freshKey();

    rateLimit(victim, opts);
    expect(() => rateLimit(victim, opts)).toThrow(AppError);

    // MAX_KEYS is 10_000; one more than that guarantees the coldest key — the
    // victim, inserted first — is shed.
    for (let i = 0; i < 10_001; i++) rateLimit(`burst:${i}`, opts);

    // The clock has not moved, so the victim's window is nowhere near elapsed.
    // Forgiving it now can only mean its entry is gone, which is the bound this
    // test is here for: the map does not retain a key forever.
    expect(() => rateLimit(victim, opts)).not.toThrow();
  });
});
