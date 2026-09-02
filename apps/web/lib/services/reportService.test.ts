import { expect, mock, test } from "bun:test";
import type { Turn } from "@repo/db";

mock.module("server-only", () => ({}));
process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

mock.module("@/lib/env", () => ({
  config: {
    storageConfigured: false,
    site: { url: "http://localhost:4000" },
    audio: { serviceUrl: "http://audio.test", retentionDays: 30 },
    rotation: { providerTimeoutMs: 1_000, baseBackoffMs: 1 },
    gemini: { keys: [], model: "test-model" },
    groq: { keys: [], llmFallbackModel: "test-model" },
    auth: { passwordMinLength: 8 },
    interview: { defaultNumQuestions: 8 },
    drill: { dailyCards: 10, digestDays: 3 },
    video: { maxParts: 2_000 },
  },
}));
mock.module("@/lib/clients/http", () => ({
  fetchWithTimeout: mock(async () => new Response(null, { status: 503 })),
  ensureOk: mock(async (res: Response) => res),
}));
mock.module("@/lib/clients/llmJson", () => ({
  generateJson: mock(async () => ({ value: {}, raw: "" })),
}));
mock.module("@/lib/storage/objectStore", () => ({
  getAudio: mock(async () => new Uint8Array()),
  presignGet: mock(async () => "https://signed.test/board.png"),
}));
mock.module("@/lib/db/repo", () => ({
  getTurns: mock(async () => []),
  getUserById: mock(async () => null),
  createReport: mock(async () => ({})),
  rubricMean: mock(() => null),
}));
mock.module("@/lib/mail/mailer", () => ({
  mailConfigured: () => false,
  sendMail: mock(async () => {}),
}));

const { computeDelivery } = await import("./reportService");

function turn(over: Partial<Turn>): Turn {
  return {
    turnIndex: 0,
    question: "Question",
    questionType: "technical",
    transcript: null,
    transcriptWords: null,
    transcriptConfidence: null,
    responseLatencyMs: null,
    interruptedAtS: null,
    cameraMetrics: null,
    codeSubmission: null,
    designReview: null,
    audioKey: null,
    ...over,
  } as Turn;
}

test("a design turn counts the fillers the candidate said, not the ones the reviewer wrote", async () => {
  const delivery = await computeDelivery([
    turn({
      designReview: { components: ["api gateway"] } as unknown as Turn["designReview"],
      transcript: [
        "[design] components: api gateway, postgres | missing: a cache like redis in front of reads" +
          " | SPOF: the single primary",
        "Spoken: I would shard it, um, by store.",
      ].join("\n"),
    }),
  ]);

  expect(delivery.filler_count).toBe(1);
});

test("a coding turn counts the fillers spoken at the keyboard, not the words in the source", async () => {
  const delivery = await computeDelivery([
    turn({
      codeSubmission: { language: "python" } as unknown as Turn["codeSubmission"],
      transcript: [
        "[python] 3/4 tests passed",
        "```",
        "counts = {}  # a dict, like redis but in memory",
        "```",
        "Spoken while coding: uh, I keep a dict of counts.",
      ].join("\n"),
    }),
  ]);

  expect(delivery.filler_count).toBe(1);
});

test("time to first word ignores the silence before a coding turn's think-aloud", async () => {
  const delivery = await computeDelivery([
    turn({ transcript: "I would shard it by store.", responseLatencyMs: 900, interruptedAtS: 76 }),
    turn({
      turnIndex: 1,
      codeSubmission: { language: "python" } as unknown as Turn["codeSubmission"],
      transcript: "[python] 3/4 tests passed",
      responseLatencyMs: 45_000,
    }),
  ]);

  expect(delivery.response_latency_ms).toBe(900);
  expect(delivery.interruptions).toBe(1);
});

test("a spoken turn still counts every filler in the whole answer", async () => {
  const delivery = await computeDelivery([
    turn({ transcript: "Um, I would shard it, you know, by store, um, and cache the reads." }),
  ]);

  expect(delivery.filler_count).toBe(3);
});
