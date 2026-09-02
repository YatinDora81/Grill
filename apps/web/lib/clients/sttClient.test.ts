import { test, expect, mock, describe } from "bun:test";
import type { TranscriptSegment } from "@repo/types";

mock.module("server-only", () => ({}));

mock.module("@/lib/env", () => ({
  config: {
    gemini: { keys: [] },
    groq: { keys: [], whisperModel: "whisper-large-v3" },
    rotation: { baseBackoffMs: 1, providerTimeoutMs: 1000 },
  },
}));

const { transcriberConfidence } = await import("@/lib/clients/sttClient");

function segment(
  start: number,
  end: number,
  avg_logprob: number | null,
): TranscriptSegment {
  return { start, end, avg_logprob, no_speech_prob: null, compression_ratio: null };
}

describe("transcriberConfidence", () => {
  test("a session with no segments at all has no confidence, not a zero", () => {
    expect(transcriberConfidence([])).toBe(null);
  });

  test("segments carry their duration as weight, so a long one counts for more", () => {
    expect(transcriberConfidence([segment(0, 9, -0.2), segment(9, 10, -0.7)])).toBe(-0.25);
  });

  test("equal durations average plainly", () => {
    expect(transcriberConfidence([segment(0, 2, -0.4), segment(2, 4, -0.6)])).toBe(-0.5);
  });

  test("a segment Whisper gave no log-probability for is skipped, never read as certainty", () => {
    expect(transcriberConfidence([segment(0, 5, null), segment(5, 6, -0.8)])).toBe(-0.8);
    expect(transcriberConfidence([segment(0, 5, null)])).toBe(null);
  });

  test("an infinite log-probability is not a number to average", () => {
    expect(transcriberConfidence([segment(0, 5, -Infinity), segment(5, 6, -0.3)])).toBe(-0.3);
    expect(transcriberConfidence([segment(0, 5, Number.NaN)])).toBe(null);
  });

  test("a zero-length segment still carries a floor of weight rather than vanishing", () => {
    expect(transcriberConfidence([segment(3, 3, -0.5)])).toBe(-0.5);
  });

  test("the value is kept raw and negative, rounded to three decimals", () => {
    const mean = transcriberConfidence([segment(0, 1, -0.123456), segment(1, 2, -0.2)]);
    expect(mean).toBe(-0.162);
    expect(mean!).toBeLessThan(0);
  });
});
