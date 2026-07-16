import { test, expect, mock, beforeEach } from "bun:test";
import { AllKeysExhausted } from "@/lib/errors";

/**
 * Rotation is failover, so the question every test here asks is the same one:
 * when one key says no, does the request still reach a key that would have said
 * yes? The 404 case is the one that got this wrong — Gemini scopes model access
 * per project, so `This model is no longer available` is a fact about the key,
 * not about the request, and the pool has to keep walking.
 */

// keyPool is a `server-only` module reached through `@/lib/env`, and env refuses
// to load without real secrets. Both are stubbed before the import so the pool
// under test is the only real thing in the file.
mock.module("server-only", () => ({}));
mock.module("@/lib/env", () => ({
  config: {
    rotation: { baseBackoffMs: 1 },
    // The module-scope geminiPool/groqPool are not what we test; give them
    // nothing so constructing them stays a no-op.
    gemini: { keys: [] },
    groq: { keys: [] },
  },
}));

const { KeyPool, ProviderError, callWithRotation } = await import("./keyPool");

const KEYS = [
  { label: "ALPHA", key: "key-alpha" },
  { label: "BRAVO", key: "key-bravo" },
  { label: "CHARLIE", key: "key-charlie" },
];

let pool: InstanceType<typeof KeyPool>;
beforeEach(() => {
  pool = new KeyPool("gemini", [...KEYS]);
});

/** retryAfterMs: 0 makes the rotate backoff resolve immediately (see the
 *  `retryAfterMs ?? base * ...` in callWithRotation) so 429 tests don't sleep. */
const providerErr = (status: number, retryAfterMs?: number) =>
  new ProviderError(status, `stub ${status}`, retryAfterMs);

test("a key that 404s is skipped and a healthy key still serves the request", async () => {
  const seen: string[] = [];
  const req = mock(async (key: string) => {
    seen.push(key);
    // One restricted project, two good ones — the shape of the real incident.
    if (key === "key-alpha") throw providerErr(404, 0);
    return "completion";
  });

  await expect(callWithRotation(pool, req)).resolves.toBe("completion");
  expect(seen).toEqual(["key-alpha", "key-bravo"]);
});

test("a 404 retires the key rather than being retried on the way round", async () => {
  const req = mock(async (key: string) => {
    if (key === "key-alpha") throw providerErr(404, 0);
    throw providerErr(429, 0);
  });

  // attempts is max(size, MIN_ATTEMPTS) = 7, so the pool comes back around
  // several times. The 404'd key must be asked exactly once across all of them;
  // re-asking a key whose project cannot see the model burns a whole turn.
  await expect(callWithRotation(pool, req)).rejects.toBeInstanceOf(AllKeysExhausted);
  const alphaCalls = req.mock.calls.filter(([k]) => k === "key-alpha");
  expect(alphaCalls).toHaveLength(1);
});

test("when every key 404s the pool exhausts rather than hard-failing the request", async () => {
  const req = mock(async () => {
    throw providerErr(404, 0);
  });

  // AllKeysExhausted is load-bearing beyond this module: generateText only
  // degrades to Groq on that error, so a 404 that escaped as-is would skip the
  // fallback too and take the whole request down.
  const err = await callWithRotation(pool, req).catch((e) => e);
  expect(err).toBeInstanceOf(AllKeysExhausted);
  expect((err as AllKeysExhausted).lastError).toBeInstanceOf(ProviderError);
  expect(((err as AllKeysExhausted).lastError as InstanceType<typeof ProviderError>).status).toBe(
    404,
  );
  // Three keys, three attempts — the pool stops once nothing is left to ask.
  expect(req).toHaveBeenCalledTimes(3);
});

test.each([401, 403])("a %i does not stop the request: the next key serves it", async (status) => {
  const req = mock(async (key: string) => {
    if (key === "key-alpha") throw providerErr(status, 0);
    return "completion";
  });

  await expect(callWithRotation(pool, req)).resolves.toBe("completion");
});

test.each([401, 403])("a %i retires the key, which is not asked again as the pool comes round", async (status) => {
  const req = mock(async (key: string) => {
    if (key === "key-alpha") throw providerErr(status, 0);
    // The rest are merely busy, so the pool keeps lapping and gets the chance to
    // ask alpha a second time. Only retiring it stops that from happening —
    // rotating alone would look identical if a healthy key answered first.
    throw providerErr(429, 0);
  });

  await expect(callWithRotation(pool, req)).rejects.toBeInstanceOf(AllKeysExhausted);
  // A revoked key is gone for this request; re-asking it is a guaranteed wasted turn.
  expect(req.mock.calls.filter(([k]) => k === "key-alpha")).toHaveLength(1);
});

test("a 429 rotates and keeps the key: it is busy, not gone", async () => {
  let alphaCalls = 0;
  const req = mock(async (key: string) => {
    if (key === "key-alpha") {
      alphaCalls++;
      // Busy on the first pass, fine on the second — a retired key would never
      // get that second pass, which is why 429 must not be classed `dead`.
      if (alphaCalls === 1) throw providerErr(429, 0);
      return "completion-alpha";
    }
    throw providerErr(429, 0);
  });

  await expect(callWithRotation(pool, req)).resolves.toBe("completion-alpha");
  expect(alphaCalls).toBe(2);
});

test("a 400 is fatal: it fails the request without burning the pool", async () => {
  const req = mock(async () => {
    // A malformed request stays malformed no matter who signs it.
    throw providerErr(400);
  });

  const err = await callWithRotation(pool, req).catch((e) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect(err).not.toBeInstanceOf(AllKeysExhausted);
  expect(err.status).toBe(400);
  // Spending all seven attempts re-sending a request every key will reject is
  // pure latency, and it would strand the caller behind a pointless retry storm.
  expect(req).toHaveBeenCalledTimes(1);

  // The pool is untouched: the fatal was about the request, so the very next
  // call still finds a working key sitting where it was left.
  await expect(callWithRotation(pool, async () => "ok")).resolves.toBe("ok");
});
