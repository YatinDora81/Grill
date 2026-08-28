import { test, expect, mock, describe } from "bun:test";
import type { AcousticMetrics, TranscriptWord } from "@repo/types";

mock.module("server-only", () => ({}));

mock.module("@/lib/env", () => ({
  config: {
    audio: { serviceUrl: "http://audio.test" },
    rotation: { providerTimeoutMs: 1000, baseBackoffMs: 1 },
    gemini: { keys: [], model: "test-model" },
    groq: { keys: [], llmFallbackModel: "test-model" },
    auth: { passwordMinLength: 8 },
    interview: { defaultNumQuestions: 8 },
    video: { maxParts: 2_000 },
  },
}));
mock.module("@/lib/clients/http", () => ({
  fetchWithTimeout: mock(async () => new Response(null, { status: 503 })),
  ensureOk: mock(async (res: Response) => res),
}));

const {
  countFillers,
  textDeliveryMetrics,
  statementEnds,
  aggregateAcoustics,
  aggregateCamera,
  combineDelivery,
} = await import("@/lib/services/deliveryService");

function words(...spans: [start: number, end: number][]): TranscriptWord[] {
  return spans.map(([start, end], i) => ({ word: `w${i}`, start, end }));
}

function spoken(w: TranscriptWord[], transcript = "") {
  return { transcript, transcriptWords: w };
}

describe("textDeliveryMetrics", () => {
  test("a typed interview reports wpm and avg_pause_ms as a plain 0, indistinguishable from a measured 0", () => {
    const typed = textDeliveryMetrics([
      { transcript: "I would use a hash map, um, keyed by user id.", transcriptWords: null },
      { transcript: "No transcriptWords because nobody spoke.", transcriptWords: [] },
    ]);

    expect(typed).toEqual({ wpm: 0, avg_pause_ms: 0, filler_count: 1 });
    expect(Object.is(typed.wpm, 0)).toBe(true);
    expect(Object.is(typed.avg_pause_ms, 0)).toBe(true);
  });

  test("no turns at all yields zeros rather than NaN", () => {
    const empty = textDeliveryMetrics([]);
    expect(empty).toEqual({ wpm: 0, avg_pause_ms: 0, filler_count: 0 });
    expect(Number.isNaN(empty.wpm)).toBe(false);
    expect(Number.isNaN(empty.avg_pause_ms)).toBe(false);
  });

  test("wpm is words over spoken seconds, and turns are summed before dividing", () => {
    const metrics = textDeliveryMetrics([
      spoken(words([0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2])),
      spoken(words([10, 10.5], [10.5, 11], [11, 11.5], [11.5, 12])),
    ]);
    expect(metrics.wpm).toBe(120);
  });

  test("wpm is rounded to two decimals", () => {
    expect(textDeliveryMetrics([spoken(words([0, 1], [3, 4], [6, 7]))]).wpm).toBe(25.71);
  });

  test("only real gaps between words are averaged, and an overlap cannot drag the mean down", () => {
    const metrics = textDeliveryMetrics([spoken(words([0, 1], [1.5, 2], [1.9, 3]))]);
    expect(metrics.avg_pause_ms).toBe(500);
  });

  test("a single word yields no pause measurement, reported as 0", () => {
    const metrics = textDeliveryMetrics([spoken(words([2, 2.5]))]);
    expect(metrics.avg_pause_ms).toBe(0);
    expect(metrics.wpm).toBe(120);
  });

  test("a turn whose words all carry zero duration cannot divide by zero", () => {
    const metrics = textDeliveryMetrics([spoken(words([4, 4], [4, 4]))]);
    expect(metrics.wpm).toBe(0);
    expect(Number.isFinite(metrics.wpm)).toBe(true);
  });

  test("filler_count comes from the transcript text even when no words are timed", () => {
    expect(
      textDeliveryMetrics([{ transcript: "um, I mean, like whatever", transcriptWords: null }])
        .filler_count,
    ).toBe(3);
  });
});

describe("countFillers", () => {
  test("fillers are matched as whole words, never inside longer ones", () => {
    expect(countFillers("An umbrella under my thumb, uhhuh, hmmm")).toBe(0);
    expect(countFillers("Um... uh! erm? (hmm)")).toBe(4);
  });

  test("multi-word fillers count once, and case is ignored", () => {
    expect(countFillers("You know, I Mean, that's the trade-off")).toBe(2);
  });

  test("'like' is skipped where a literal reading is available", () => {
    expect(countFillers("I would like to, it looks like a tree, do it like this")).toBe(0);
  });

  test("'like' still counts where no literal reading fits", () => {
    expect(countFillers("It was, like, three seconds")).toBe(1);
  });
});

describe("statementEnds", () => {
  function timed(text: string, from = 0): TranscriptWord[] {
    return text
      .split(" ")
      .map((word, i) => ({ word, start: from + i, end: from + i + 0.5 }));
  }

  test("only statements are offered to the uptalk detector", () => {
    const ends = statementEnds([
      ...timed("We sharded the ledger by tenant.", 0),
      ...timed("Yes.", 10),
      ...timed("Did you want the failover story?", 20),
    ]);
    expect(ends).toEqual([5.5]);
  });

  test("a question keeps its exclusion through a trailing quote", () => {
    expect(statementEnds(timed('Should we shard this now?"'))).toEqual([]);
  });

  test("four words is a statement, three is not", () => {
    expect(statementEnds(timed("We sharded the ledger."))).toEqual([3.5]);
    expect(statementEnds(timed("We sharded it."))).toEqual([]);
  });

  test("an unpunctuated run still ends a statement", () => {
    expect(statementEnds(timed("we migrated the ledger last spring"))).toEqual([5.5]);
  });

  test("no words means nothing to judge, not an ending at zero", () => {
    expect(statementEnds(null)).toEqual([]);
    expect(statementEnds([])).toEqual([]);
  });
});

describe("aggregateAcoustics", () => {
  const m = (
    pitch_variation: number,
    energy: number,
    mean_pitch_hz: number,
    voice: Partial<AcousticMetrics> = {},
  ): AcousticMetrics => ({
    pitch_variation,
    energy,
    mean_pitch_hz,
    jitter_local: null,
    shimmer_local: null,
    hnr_db: null,
    uptalk_statements: null,
    uptalk_rising: null,
    ...voice,
  });

  const NO_VOICE_QUALITY = {
    jitter_local: null,
    shimmer_local: null,
    hnr_db: null,
    uptalk_pct: null,
    uptalk_statements: 0,
    uptalk_rising: 0,
  };

  test("an empty set returns nulls, not NaN", () => {
    expect(aggregateAcoustics([])).toEqual({
      pitch_variation: null,
      energy: null,
      mean_pitch_hz: null,
      ...NO_VOICE_QUALITY,
    });
  });

  test("an all-null set (audio service down for every clip) returns nulls", () => {
    expect(aggregateAcoustics([null, null])).toEqual({
      pitch_variation: null,
      energy: null,
      mean_pitch_hz: null,
      ...NO_VOICE_QUALITY,
    });
  });

  test("nulls are excluded from the denominator, not counted as zeros", () => {
    expect(aggregateAcoustics([null, m(10, 0.1, 200), m(14, 0.2, 200)])).toEqual({
      pitch_variation: 12,
      energy: 0.15,
      mean_pitch_hz: 200,
      ...NO_VOICE_QUALITY,
    });
  });

  test("a single present result passes through rounded to two decimals", () => {
    expect(aggregateAcoustics([m(12.345, 0.6789, 187.5)])).toEqual({
      pitch_variation: 12.35,
      energy: 0.68,
      mean_pitch_hz: 187.5,
      ...NO_VOICE_QUALITY,
    });
  });

  test("voice quality averages the clips that carried it, and uptalk sums across them", () => {
    const old = m(10, 0.2, 180);
    const a = m(10, 0.2, 180, {
      jitter_local: 0.01,
      shimmer_local: 0.04,
      hnr_db: 18,
      uptalk_statements: 4,
      uptalk_rising: 1,
    });
    const b = m(10, 0.2, 180, {
      jitter_local: 0.02,
      shimmer_local: 0.06,
      hnr_db: 22,
      uptalk_statements: 6,
      uptalk_rising: 2,
    });

    expect(aggregateAcoustics([old, a, b])).toEqual({
      pitch_variation: 10,
      energy: 0.2,
      mean_pitch_hz: 180,
      jitter_local: 0.015,
      shimmer_local: 0.05,
      hnr_db: 20,
      uptalk_pct: 30,
      uptalk_statements: 10,
      uptalk_rising: 3,
    });
  });

  test("jitter and shimmer keep five decimals, because two would round a reading away", () => {
    const one = aggregateAcoustics([
      m(10, 0.2, 180, { jitter_local: 0.004321, shimmer_local: 0.0195, hnr_db: 19.456 }),
    ]);
    expect(one.jitter_local).toBe(0.00432);
    expect(one.shimmer_local).toBe(0.0195);
    expect(one.hnr_db).toBe(19.46);
  });

  test("uptalk is 0 % only where endings were actually judged", () => {
    const judged = aggregateAcoustics([m(10, 0.2, 180, { uptalk_statements: 5, uptalk_rising: 0 })]);
    expect(judged.uptalk_pct).toBe(0);
    expect(judged.uptalk_statements).toBe(5);

    const nothing = aggregateAcoustics([
      m(10, 0.2, 180, { uptalk_statements: 0, uptalk_rising: 0 }),
    ]);
    expect(nothing.uptalk_pct).toBe(null);
    expect(nothing.uptalk_statements).toBe(0);
  });
});

describe("aggregateCamera", () => {
  function cam(frames: number, on_camera_pct: number, smile_pct: number, head_motion_dps: number) {
    return {
      frames,
      no_face_frames: 0,
      on_camera_pct,
      smile_pct,
      head_motion_dps,
      away_segments: [],
      longest_away_ms: 0,
      sample_hz: 5,
      pose_source: "matrix",
    };
  }

  const NOT_MEASURED = {
    on_camera_pct: null,
    smile_pct: null,
    head_motion_dps: null,
    camera_turns: 0,
  };

  test("no turn carried camera metrics, so the three figures are null and not 0", () => {
    expect(aggregateCamera([])).toEqual(NOT_MEASURED);
    expect(aggregateCamera([{ cameraMetrics: null }, { cameraMetrics: undefined }])).toEqual(
      NOT_MEASURED,
    );
  });

  test("turns are weighted by the frames a face was actually found in", () => {
    expect(
      aggregateCamera([
        { cameraMetrics: cam(100, 90, 20, 4) },
        { cameraMetrics: cam(300, 50, 0, 12) },
      ]),
    ).toEqual({
      on_camera_pct: 60,
      smile_pct: 5,
      head_motion_dps: 10,
      camera_turns: 2,
    });
  });

  test("a turn the model never found a face in measured nothing, so it is dropped", () => {
    expect(
      aggregateCamera([{ cameraMetrics: cam(0, 0, 0, 0) }, { cameraMetrics: cam(200, 80, 10, 5) }]),
    ).toEqual({
      on_camera_pct: 80,
      smile_pct: 10,
      head_motion_dps: 5,
      camera_turns: 1,
    });
    expect(aggregateCamera([{ cameraMetrics: cam(0, 0, 0, 0) }])).toEqual(NOT_MEASURED);
  });

  test("a corrupt stored column is skipped rather than trusted", () => {
    const result = aggregateCamera([
      { cameraMetrics: { frames: 40, on_camera_pct: 100 } },
      { cameraMetrics: '{"frames":40,"on_camera_pct":100}' },
      { cameraMetrics: { ...cam(40, 100, 0, 1), on_camera_pct: 140 } },
      { cameraMetrics: cam(200, 80, 10, 5) },
    ]);

    expect(result).toEqual({
      on_camera_pct: 80,
      smile_pct: 10,
      head_motion_dps: 5,
      camera_turns: 1,
    });
    expect(Number.isNaN(result.on_camera_pct)).toBe(false);
  });

  test("weighted figures are rounded to two decimals", () => {
    expect(
      aggregateCamera([
        { cameraMetrics: cam(1, 50, 0, 0) },
        { cameraMetrics: cam(2, 90, 0, 0) },
      ]).on_camera_pct,
    ).toBe(76.67);
  });
});

describe("combineDelivery", () => {
  const TEXT = { wpm: 120, avg_pause_ms: 500, filler_count: 3 };

  test("absence survives the merge from all three halves", () => {
    expect(
      combineDelivery(
        TEXT,
        {
          pitch_variation: null,
          energy: null,
          mean_pitch_hz: null,
          jitter_local: null,
          shimmer_local: null,
          hnr_db: null,
          uptalk_pct: null,
          uptalk_statements: 0,
          uptalk_rising: 0,
        },
        { on_camera_pct: null, smile_pct: null, head_motion_dps: null, camera_turns: 0 },
      ),
    ).toEqual({
      wpm: 120,
      avg_pause_ms: 500,
      filler_count: 3,
      pitch_variation: null,
      energy: null,
      mean_pitch_hz: null,
      jitter_local: null,
      shimmer_local: null,
      hnr_db: null,
      uptalk_pct: null,
      uptalk_statements: 0,
      uptalk_rising: 0,
      on_camera_pct: null,
      smile_pct: null,
      head_motion_dps: null,
      camera_turns: 0,
    });
  });

  test("every measured figure keeps its name and its value", () => {
    expect(
      combineDelivery(
        TEXT,
        {
          pitch_variation: 21.4,
          energy: 0.58,
          mean_pitch_hz: 118,
          jitter_local: 0.014,
          shimmer_local: 0.062,
          hnr_db: 19.2,
          uptalk_pct: 11.54,
          uptalk_statements: 26,
          uptalk_rising: 3,
        },
        { on_camera_pct: 84.2, smile_pct: 18.5, head_motion_dps: 6.1, camera_turns: 5 },
      ),
    ).toEqual({
      wpm: 120,
      avg_pause_ms: 500,
      filler_count: 3,
      pitch_variation: 21.4,
      energy: 0.58,
      mean_pitch_hz: 118,
      jitter_local: 0.014,
      shimmer_local: 0.062,
      hnr_db: 19.2,
      uptalk_pct: 11.54,
      uptalk_statements: 26,
      uptalk_rising: 3,
      on_camera_pct: 84.2,
      smile_pct: 18.5,
      head_motion_dps: 6.1,
      camera_turns: 5,
    });
  });
});
