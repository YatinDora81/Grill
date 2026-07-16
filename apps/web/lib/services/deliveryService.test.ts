import { test, expect, mock, describe } from "bun:test";
import type { AcousticMetrics, TranscriptWord } from "@repo/types";

/**
 * Every number here is handed to the report LLM under a header that calls it a
 * measured fact, so the arithmetic is the honesty boundary: a NaN or a
 * divide-by-zero does not crash, it gets stored and graded. These pin the three
 * places that can silently produce one — no timed words, no gaps, no acoustics.
 */

// `server-only` is a build-time marker that throws when imported outside an RSC.
mock.module("server-only", () => ({}));

// env validates at module scope and throws without real keys; the maths under
// test never reads it, only analyzeAcoustics does.
mock.module("@/lib/env", () => ({
  config: { audio: { serviceUrl: "http://audio.test" }, rotation: { providerTimeoutMs: 1000 } },
}));
mock.module("@/lib/clients/http", () => ({
  fetchWithTimeout: mock(async () => new Response(null, { status: 503 })),
}));

const { countFillers, textDeliveryMetrics, aggregateAcoustics, combineDelivery } = await import(
  "@/lib/services/deliveryService"
);

/** Whisper-shaped words: `word` is unused by the maths, timings are everything. */
function words(...spans: [start: number, end: number][]): TranscriptWord[] {
  return spans.map(([start, end], i) => ({ word: `w${i}`, start, end }));
}

function spoken(w: TranscriptWord[], transcript = "") {
  return { transcript, transcriptWords: w };
}

describe("textDeliveryMetrics", () => {
  test("a typed interview reports wpm and avg_pause_ms as a plain 0, indistinguishable from a measured 0", () => {
    // report.ts gates the whole delivery block on `wpm > 0` precisely because
    // this 0 is the same value a real measurement would produce. If this ever
    // became null/NaN/-1 the gate would stop firing and typed candidates would
    // be graded for "speaking at 0 wpm" again.
    const typed = textDeliveryMetrics([
      { transcript: "I would use a hash map, um, keyed by user id.", transcriptWords: null },
      { transcript: "No transcriptWords because nobody spoke.", transcriptWords: [] },
    ]);

    expect(typed).toEqual({ wpm: 0, avg_pause_ms: 0, filler_count: 1 });
    expect(Object.is(typed.wpm, 0)).toBe(true); // not -0, not NaN
    expect(Object.is(typed.avg_pause_ms, 0)).toBe(true);
  });

  test("no turns at all yields zeros rather than NaN", () => {
    // totalWords/speakingSeconds are both 0 here; an unguarded divide stores NaN.
    const empty = textDeliveryMetrics([]);
    expect(empty).toEqual({ wpm: 0, avg_pause_ms: 0, filler_count: 0 });
    expect(Number.isNaN(empty.wpm)).toBe(false);
    expect(Number.isNaN(empty.avg_pause_ms)).toBe(false);
  });

  test("wpm is words over spoken seconds, and turns are summed before dividing", () => {
    // Each turn holds 4 words in 2s = 120 wpm. Measuring across the whole
    // session span (0 -> 12s) instead would report 40 wpm and read as glacial;
    // the dead air between turns is the interviewer talking, not the candidate.
    const metrics = textDeliveryMetrics([
      spoken(words([0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2])),
      spoken(words([10, 10.5], [10.5, 11], [11, 11.5], [11.5, 12])),
    ]);
    expect(metrics.wpm).toBe(120);
  });

  test("wpm is rounded to two decimals", () => {
    // 3 words / 7s * 60 = 25.714285…; the raw float would land in the prompt.
    expect(textDeliveryMetrics([spoken(words([0, 1], [3, 4], [6, 7]))]).wpm).toBe(25.71);
  });

  test("only real gaps between words are averaged, and an overlap cannot drag the mean down", () => {
    // Whisper emits overlapping spans on fast speech: word 3 starts before word
    // 2 ends. Counting that -0.1s as a pause gives (0.5 - 0.1)/2 = 200ms and
    // invents hesitation that never happened; it is dropped, leaving 500ms.
    const metrics = textDeliveryMetrics([spoken(words([0, 1], [1.5, 2], [1.9, 3]))]);
    expect(metrics.avg_pause_ms).toBe(500);
  });

  test("a single word yields no pause measurement, reported as 0", () => {
    // One word means zero gaps: the mean of an empty list. Same disguised
    // absence as the typed case — report.ts prints it as NOT MEASURED.
    const metrics = textDeliveryMetrics([spoken(words([2, 2.5]))]);
    expect(metrics.avg_pause_ms).toBe(0);
    expect(metrics.wpm).toBe(120); // the word itself was still timed
  });

  test("a turn whose words all carry zero duration cannot divide by zero", () => {
    // Degenerate Whisper output (start === end). speakingSeconds stays 0.
    const metrics = textDeliveryMetrics([spoken(words([4, 4], [4, 4]))]);
    expect(metrics.wpm).toBe(0);
    expect(Number.isFinite(metrics.wpm)).toBe(true);
  });

  test("filler_count comes from the transcript text even when no words are timed", () => {
    // The text exists for typed and spoken answers alike, so unlike pace this
    // one is always a real measurement and report.ts always prints it.
    expect(
      textDeliveryMetrics([{ transcript: "um, I mean, like whatever", transcriptWords: null }])
        .filler_count,
    ).toBe(3);
  });
});

describe("countFillers", () => {
  test("fillers are matched as whole words, never inside longer ones", () => {
    // The lookarounds are the only thing stopping "umbrella"/"thumb" from
    // reading as hesitation. Over-counting here is not cosmetic: the count is
    // handed over as a measured fact and produces a dishonest verdict.
    expect(countFillers("An umbrella under my thumb, uhhuh, hmmm")).toBe(0);
    expect(countFillers("Um... uh! erm? (hmm)")).toBe(4);
  });

  test("multi-word fillers count once, and case is ignored", () => {
    expect(countFillers("You know, I Mean, that's the trade-off")).toBe(2);
  });

  test("'like' is skipped where a literal reading is available", () => {
    // Deliberate under-counting: "I'd like to" / "looks like a" are ordinary
    // vocabulary. If the guards regress, every comparative becomes a filler.
    expect(countFillers("I would like to, it looks like a tree, do it like this")).toBe(0);
  });

  test("'like' still counts where no literal reading fits", () => {
    // The other half of the same bet — dropping "like" entirely would miss the
    // most common real filler in speech.
    expect(countFillers("It was, like, three seconds")).toBe(1);
  });
});

describe("aggregateAcoustics", () => {
  const m = (pitch_variation: number, energy: number, mean_pitch_hz: number): AcousticMetrics => ({
    pitch_variation,
    energy,
    mean_pitch_hz,
  });

  test("an empty set returns nulls, not NaN", () => {
    // 0/0 here would store NaN, which JSON-serialises to null in some paths and
    // to a broken value in others — and report.ts only treats `null` as absent.
    expect(aggregateAcoustics([])).toEqual({
      pitch_variation: null,
      energy: null,
      mean_pitch_hz: null,
    });
  });

  test("an all-null set (audio service down for every clip) returns nulls", () => {
    // analyzeAcoustics returns null per failed clip; every clip failing must
    // read as "unavailable", never as measured silence.
    expect(aggregateAcoustics([null, null])).toEqual({
      pitch_variation: null,
      energy: null,
      mean_pitch_hz: null,
    });
  });

  test("nulls are excluded from the denominator, not counted as zeros", () => {
    // Two clips analysed, one failed. Dividing by results.length would report
    // 8 / 0.1 / 133.33 — a third quieter and flatter than the candidate was.
    expect(aggregateAcoustics([null, m(10, 0.1, 200), m(14, 0.2, 200)])).toEqual({
      pitch_variation: 12,
      energy: 0.15, // 0.30000000000000004 / 2 without the rounding
      mean_pitch_hz: 200,
    });
  });

  test("a single present result passes through rounded to two decimals", () => {
    expect(aggregateAcoustics([m(12.345, 0.6789, 187.5)])).toEqual({
      pitch_variation: 12.35,
      energy: 0.68,
      mean_pitch_hz: 187.5,
    });
  });
});

test("combineDelivery merges text and acoustic halves without dropping absence", () => {
  // The null acoustics must survive into the stored DeliveryMetrics — that null
  // is what the report renders as NOT MEASURED.
  expect(
    combineDelivery(
      { wpm: 120, avg_pause_ms: 500, filler_count: 3 },
      { pitch_variation: null, energy: null, mean_pitch_hz: null },
    ),
  ).toEqual({
    wpm: 120,
    avg_pause_ms: 500,
    filler_count: 3,
    pitch_variation: null,
    energy: null,
    mean_pitch_hz: null,
  });
});
