import { test, expect, mock, beforeEach } from "bun:test";
import type { Session, Turn } from "@repo/db";
import type { Persona } from "@repo/types";

mock.module("server-only", () => ({}));

const envConfig = {
  ttsConfigured: true,
  tts: {
    model: "canopylabs/orpheus-v1-english",
    cachePrefix: "tts/orpheus/",
    maxChars: 40,
  },
};
mock.module("@/lib/env", () => ({ config: envConfig }));

const synthesize = mock(async (_text: string, _voice: string) => ({
  bytes: new Uint8Array([1, 2, 3]),
  mime: "audio/wav",
}));
mock.module("@/lib/clients/ttsClient", () => ({ synthesize, SPEECH_FORMAT: "wav" }));

let cached = false;
let headFails = false;
const headObject = mock(async (_key: string) => {
  if (headFails) throw new Error("bucket on fire");
  return cached;
});
const putObject = mock(async (_key: string, _bytes: Uint8Array, _mime: string) => {});
const presignGet = mock(async (key: string, ttl?: number) => `https://r2.test/${key}?ttl=${ttl}`);
mock.module("@/lib/storage/objectStore", () => ({ headObject, putObject, presignGet }));

let budgetLeft = true;
let budgetHeadroom = 17;
const tryConsume = mock(async () => budgetLeft);
const remaining = mock(async () => budgetHeadroom);
mock.module("./ttsBudget", () => ({ tryConsume, remaining }));

let persona: Persona = "neutral";
let contextThrows = false;
mock.module("./sessionContext", () => ({
  toSessionContext: () => {
    if (contextThrows) throw new Error("unreadable config");
    return { config: { persona } };
  },
}));

const { PERSONA_VOICE } = await import("@/lib/interviewMeta");
const { cacheKey, isLatinScript, questionAudio, spokenText } = await import("./voiceService");

const session = { id: "sess_1" } as Session;
const turn = (question: string) => ({ turnIndex: 2, question }) as Turn;

beforeEach(() => {
  cached = false;
  headFails = false;
  budgetLeft = true;
  budgetHeadroom = 17;
  persona = "neutral";
  contextThrows = false;
  synthesize.mockClear();
  putObject.mockClear();
  headObject.mockClear();
  tryConsume.mockClear();
  remaining.mockClear();
  presignGet.mockClear();
});

test("prefixes the persona's direction and trims the question", () => {
  expect(spokenText("friendly_screen", "  Why did you leave?  ")).toBe(
    "[cheerful] Why did you leave?",
  );
  expect(spokenText("terse_staff", "Why did you leave?")).toBe("Why did you leave?");
});

test("cuts the spoken text to the configured ceiling", () => {
  const long = "x".repeat(200);
  expect(spokenText("neutral", long)).toHaveLength(envConfig.tts.maxChars);
});

test("gives identical input the same key every time", () => {
  expect(cacheKey("hannah", "Why did you leave?")).toBe(cacheKey("hannah", "Why did you leave?"));
  expect(cacheKey("hannah", "Why did you leave?")).toStartWith("tts/orpheus/");
  expect(cacheKey("hannah", "Why did you leave?")).toEndWith(".wav");
});

test("gives a different key to a different voice, text or model", () => {
  const base = cacheKey("hannah", "Why did you leave?");
  expect(cacheKey("troy", "Why did you leave?")).not.toBe(base);
  expect(cacheKey("hannah", "Why did you really leave?")).not.toBe(base);

  envConfig.tts.model = "some/other-voice-model";
  expect(cacheKey("hannah", "Why did you leave?")).not.toBe(base);
  envConfig.tts.model = "canopylabs/orpheus-v1-english";
});

test("says nothing at all when the feature is not configured", async () => {
  envConfig.ttsConfigured = false;
  try {
    const outcome = await questionAudio(session, turn("Why did you leave?"));

    expect(outcome).toEqual({ url: null, provider: "browser", reason: "disabled" });
    expect(remaining).not.toHaveBeenCalled();
    expect(headObject).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  } finally {
    envConfig.ttsConfigured = true;
  }
});

test("serves a cached clip without touching the provider or the budget", async () => {
  cached = true;

  const outcome = await questionAudio(session, turn("Why did you leave?"));

  expect(outcome).toEqual({
    url: `https://r2.test/${cacheKey("hannah", "Why did you leave?")}?ttl=3600`,
    provider: "orpheus",
    cached: true,
    budget_remaining: 17,
  });
  expect(synthesize).not.toHaveBeenCalled();
  expect(tryConsume).not.toHaveBeenCalled();
});

test("synthesises a miss once and stores it under the key the next lookup will use", async () => {
  const key = cacheKey("hannah", "Why did you leave?");

  const outcome = await questionAudio(session, turn("Why did you leave?"));

  expect(synthesize).toHaveBeenCalledWith("Why did you leave?", "hannah");
  expect(putObject.mock.calls[0]?.[0]).toBe(key);
  expect(putObject.mock.calls[0]?.[2]).toBe("audio/wav");
  expect(outcome).toEqual({
    url: `https://r2.test/${key}?ttl=3600`,
    provider: "orpheus",
    cached: false,
    budget_remaining: 17,
  });
});

test("reads with the persona's own voice", async () => {
  persona = "skeptic";

  await questionAudio(session, turn("Are you sure that scaled?"));

  expect(synthesize).toHaveBeenCalledWith(
    "Are you sure that scaled?",
    PERSONA_VOICE.skeptic.voice,
  );
});

test("falls back to the neutral voice when the session's config cannot be read", async () => {
  contextThrows = true;

  const outcome = await questionAudio(session, turn("Why did you leave?"));

  expect(synthesize).toHaveBeenCalledWith("Why did you leave?", PERSONA_VOICE.neutral.voice);
  expect(outcome.provider).toBe("orpheus");
});

test("hands the question to the browser voice once the day's budget is gone", async () => {
  budgetLeft = false;
  budgetHeadroom = 0;

  const outcome = await questionAudio(session, turn("Why did you leave?"));

  expect(outcome).toEqual({ url: null, provider: "browser", reason: "budget", budget_remaining: 0 });
  expect(synthesize).not.toHaveBeenCalled();
});

test("falls back rather than throwing when the provider fails", async () => {
  synthesize.mockImplementationOnce(async () => {
    throw new Error("all keys exhausted");
  });

  const outcome = await questionAudio(session, turn("Why did you leave?"));

  expect(outcome).toEqual({
    url: null,
    provider: "browser",
    reason: "provider",
    budget_remaining: 17,
  });
  expect(putObject).not.toHaveBeenCalled();
});

test("stops at a broken bucket instead of spending a call it cannot keep", async () => {
  headFails = true;

  const outcome = await questionAudio(session, turn("Why did you leave?"));

  expect(outcome).toEqual({
    url: null,
    provider: "browser",
    reason: "storage",
    budget_remaining: 17,
  });
  expect(tryConsume).not.toHaveBeenCalled();
  expect(synthesize).not.toHaveBeenCalled();
});

test("recognises the scripts Orpheus can and cannot read", () => {
  expect(isLatinScript("Why did you leave?")).toBe(true);
  expect(isLatinScript("How did you scale Gaël's queue?")).toBe(true);

  expect(isLatinScript("आपने वह सिस्टम कैसे बनाया?")).toBe(false);
  expect(isLatinScript("あのシステムはどう作りましたか？")).toBe(false);
  expect(isLatinScript("Почему вы ушли?")).toBe(false);
});

test("lets a foreign token inside an English question through", () => {
  expect(isLatinScript("What does 北京 mean in that config key?")).toBe(true);
});

test("passes text that has no letters to argue about", () => {
  expect(isLatinScript("99.9% — 500?")).toBe(true);
});

test("hands a question Orpheus cannot read to the browser voice", async () => {
  const outcome = await questionAudio(session, turn("आपने वह सिस्टम कैसे बनाया?"));

  expect(outcome).toEqual({
    url: null,
    provider: "browser",
    reason: "language",
    budget_remaining: 17,
  });
  expect(headObject).not.toHaveBeenCalled();
  expect(tryConsume).not.toHaveBeenCalled();
  expect(synthesize).not.toHaveBeenCalled();
});

test("reports the day's headroom without a budget of its own to spend", async () => {
  cached = true;
  budgetHeadroom = 4;

  const outcome = await questionAudio(session, turn("Why did you leave?"));

  expect(outcome.budget_remaining).toBe(4);
  expect(tryConsume).not.toHaveBeenCalled();
});

test("still answers when the budget counter cannot be read", async () => {
  cached = true;
  remaining.mockImplementationOnce(async () => {
    throw new Error("redis gone");
  });

  const outcome = await questionAudio(session, turn("Why did you leave?"));

  expect(outcome.provider).toBe("orpheus");
  expect(outcome.budget_remaining).toBeUndefined();
});
