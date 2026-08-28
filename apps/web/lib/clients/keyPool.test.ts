import { test, expect, mock, beforeEach } from "bun:test";
import { AllKeysExhausted } from "@/lib/errors";

mock.module("server-only", () => ({}));
mock.module("@/lib/env", () => ({
  config: {
    rotation: { baseBackoffMs: 1 },
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

const providerErr = (status: number, retryAfterMs?: number) =>
  new ProviderError(status, `stub ${status}`, retryAfterMs);

test("a key that 404s is skipped and a healthy key still serves the request", async () => {
  const seen: string[] = [];
  const req = mock(async (key: string) => {
    seen.push(key);
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

  await expect(callWithRotation(pool, req)).rejects.toBeInstanceOf(AllKeysExhausted);
  const alphaCalls = req.mock.calls.filter(([k]) => k === "key-alpha");
  expect(alphaCalls).toHaveLength(1);
});

test("when every key 404s the pool exhausts rather than hard-failing the request", async () => {
  const req = mock(async () => {
    throw providerErr(404, 0);
  });

  const err = await callWithRotation(pool, req).catch((e) => e);
  expect(err).toBeInstanceOf(AllKeysExhausted);
  expect((err as AllKeysExhausted).lastError).toBeInstanceOf(ProviderError);
  expect(((err as AllKeysExhausted).lastError as InstanceType<typeof ProviderError>).status).toBe(
    404,
  );
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
    throw providerErr(429, 0);
  });

  await expect(callWithRotation(pool, req)).rejects.toBeInstanceOf(AllKeysExhausted);
  expect(req.mock.calls.filter(([k]) => k === "key-alpha")).toHaveLength(1);
});

test("a 429 rotates and keeps the key: it is busy, not gone", async () => {
  let alphaCalls = 0;
  const req = mock(async (key: string) => {
    if (key === "key-alpha") {
      alphaCalls++;
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
    throw providerErr(400);
  });

  const err = await callWithRotation(pool, req).catch((e) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect(err).not.toBeInstanceOf(AllKeysExhausted);
  expect(err.status).toBe(400);
  expect(req).toHaveBeenCalledTimes(1);

  await expect(callWithRotation(pool, async () => "ok")).resolves.toBe("ok");
});
