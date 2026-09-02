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
  statementSpans,
  aggregateAcoustics,
  aggregateCamera,
  aggregateConfidence,
  aggregateLatency,
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
    return text.split(" ").map((word, i) => ({ word, start: from + i, end: from + i + 0.5 }));
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

describe("statementSpans", () => {
  function timed(text: string, from = 0): TranscriptWord[] {
    return text.split(" ").map((word, i) => ({ word, start: from + i, end: from + i + 0.5 }));
  }

  test("the same statements the uptalk detector gets, carrying where each one started", () => {
    const words = [
      ...timed("We sharded the ledger by tenant.", 0),
      ...timed("Yes.", 10),
      ...timed("Did you want the failover story?", 20),
      ...timed("We kept a global sequence.", 30),
    ];

    expect(statementSpans(words)).toEqual([
      { start: 0, end: 5.5 },
      { start: 30, end: 34.5 },
    ]);
    expect(statementSpans(words).map((s) => s.end)).toEqual(statementEnds(words));
  });

  test("a span always ends after it starts, so the audio service can trust it", () => {
    for (const span of statementSpans(timed("we migrated the ledger last spring"))) {
      expect(span.end).toBeGreaterThan(span.start);
    }
  });

  test("no words means no spans, not a span at zero", () => {
    expect(statementSpans(null)).toEqual([]);
    expect(statementSpans([])).toEqual([]);
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
    articulation_rate_sps: null,
    speech_rate_sps: null,
    phonation_ratio: null,
    trailing_off_pct: null,
    trailing_off_statements: 0,
    trailing_off_fading: 0,
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
      articulation_rate_sps: null,
      speech_rate_sps: null,
      phonation_ratio: null,
      trailing_off_pct: null,
      trailing_off_statements: 0,
      trailing_off_fading: 0,
    });
  });

  test("the rates average over the clips that carried them, to three decimals", () => {
    const rates = aggregateAcoustics([
      m(10, 0.2, 180),
      m(10, 0.2, 180, {
        articulation_rate_sps: 4.5,
        speech_rate_sps: 3.2,
        phonation_ratio: 0.7111,
      }),
      m(10, 0.2, 180, {
        articulation_rate_sps: 5,
        speech_rate_sps: 3.6,
        phonation_ratio: 0.8,
      }),
    ]);

    expect(rates.articulation_rate_sps).toBe(4.75);
    expect(rates.speech_rate_sps).toBe(3.4);
    expect(rates.phonation_ratio).toBe(0.756);
  });

  test("trailing off sums its counts across clips and reports the share that faded", () => {
    const faded = aggregateAcoustics([
      m(10, 0.2, 180, { trailing_off_statements: 6, trailing_off_fading: 2 }),
      m(10, 0.2, 180, { trailing_off_statements: 2, trailing_off_fading: 1 }),
    ]);

    expect(faded.trailing_off_statements).toBe(8);
    expect(faded.trailing_off_fading).toBe(3);
    expect(faded.trailing_off_pct).toBe(37.5);
  });

  test("a clip with nothing long enough to judge is 0 %, and no clips at all is nothing", () => {
    const judged = aggregateAcoustics([
      m(10, 0.2, 180, { trailing_off_statements: 4, trailing_off_fading: 0 }),
    ]);
    expect(judged.trailing_off_pct).toBe(0);

    const nothing = aggregateAcoustics([
      m(10, 0.2, 180, { trailing_off_statements: 0, trailing_off_fading: 0 }),
    ]);
    expect(nothing.trailing_off_pct).toBe(null);
    expect(nothing.trailing_off_statements).toBe(0);
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
    const judged = aggregateAcoustics([
      m(10, 0.2, 180, { uptalk_statements: 5, uptalk_rising: 0 }),
    ]);
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

  function posture(
    frames: number,
    slouch_pct: number,
    hands_to_face_pct: number,
    shoulder_tilt_deg: number,
    wrist_motion: number,
  ) {
    return {
      frames,
      slouch_pct,
      hands_to_face_pct,
      shoulder_tilt_deg,
      wrist_motion,
      sample_hz: 3,
    };
  }

  const NO_POSTURE = {
    slouch_pct: null,
    hands_to_face_pct: null,
    shoulder_tilt_deg: null,
    wrist_motion: null,
    posture_turns: 0,
  };

  const NOT_MEASURED = {
    on_camera_pct: null,
    smile_pct: null,
    head_motion_dps: null,
    camera_turns: 0,
    ...NO_POSTURE,
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
      ...NO_POSTURE,
    });
  });

  test("posture rides along inside the camera payload, weighted by its own frames", () => {
    expect(
      aggregateCamera([
        { cameraMetrics: { ...cam(100, 90, 20, 4), posture: posture(30, 10, 0, 2, 0.1) } },
        { cameraMetrics: { ...cam(300, 50, 0, 12), posture: posture(90, 50, 8, 6, 0.3) } },
      ]),
    ).toEqual({
      on_camera_pct: 60,
      smile_pct: 5,
      head_motion_dps: 10,
      camera_turns: 2,
      slouch_pct: 40,
      hands_to_face_pct: 6,
      shoulder_tilt_deg: 5,
      wrist_motion: 0.25,
      posture_turns: 2,
    });
  });

  test("a face measured without a pose model leaves posture absent, not zeroed", () => {
    const noPose = aggregateCamera([
      { cameraMetrics: cam(100, 90, 20, 4) },
      { cameraMetrics: { ...cam(100, 90, 20, 4), posture: null } },
    ]);

    expect(noPose.camera_turns).toBe(2);
    expect(noPose).toMatchObject(NO_POSTURE);
  });

  test("a turn the pose model found nobody in is dropped from the posture weighting", () => {
    const partial = aggregateCamera([
      { cameraMetrics: { ...cam(100, 90, 20, 4), posture: posture(0, 0, 0, 0, 0) } },
      { cameraMetrics: { ...cam(100, 60, 10, 6), posture: posture(40, 25, 5, 3, 0.2) } },
    ]);

    expect(partial.posture_turns).toBe(1);
    expect(partial.slouch_pct).toBe(25);
  });

  test("a posture block the schema cannot read costs that turn its camera metrics too", () => {
    const bad = aggregateCamera([
      { cameraMetrics: { ...cam(100, 90, 20, 4), posture: { frames: 30, slouch_pct: 140 } } },
      { cameraMetrics: cam(200, 80, 10, 5) },
    ]);

    expect(bad.camera_turns).toBe(1);
    expect(bad.on_camera_pct).toBe(80);
    expect(bad).toMatchObject(NO_POSTURE);
  });

  test("a turn the model never found a face in measured nothing, so it is dropped", () => {
    expect(
      aggregateCamera([{ cameraMetrics: cam(0, 0, 0, 0) }, { cameraMetrics: cam(200, 80, 10, 5) }]),
    ).toEqual({
      on_camera_pct: 80,
      smile_pct: 10,
      head_motion_dps: 5,
      camera_turns: 1,
      ...NO_POSTURE,
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
      ...NO_POSTURE,
    });
    expect(Number.isNaN(result.on_camera_pct)).toBe(false);
  });

  test("weighted figures are rounded to two decimals", () => {
    expect(
      aggregateCamera([{ cameraMetrics: cam(1, 50, 0, 0) }, { cameraMetrics: cam(2, 90, 0, 0) }])
        .on_camera_pct,
    ).toBe(76.67);
  });
});

describe("aggregateLatency", () => {
  const turn = (responseLatencyMs: number | null, interruptedAtS: number | null = null) => ({
    responseLatencyMs,
    interruptedAtS,
  });

  test("an odd number of measured gaps reports the middle one", () => {
    expect(aggregateLatency([turn(400), turn(1_200), turn(900)])).toEqual({
      response_latency_ms: 900,
      interruptions: 0,
    });
  });

  test("an even number of measured gaps reports the mean of the middle pair, rounded", () => {
    expect(aggregateLatency([turn(400), turn(900), turn(1_200), turn(1_500)])).toEqual({
      response_latency_ms: 1_050,
      interruptions: 0,
    });
    expect(aggregateLatency([turn(400), turn(901)]).response_latency_ms).toBe(651);
  });

  test("a turn with no measured gap is skipped rather than counted as zero", () => {
    expect(aggregateLatency([turn(null), turn(800), turn(null)])).toEqual({
      response_latency_ms: 800,
      interruptions: 0,
    });
  });

  test("an interview nobody spoke in has no median at all", () => {
    expect(aggregateLatency([turn(null), turn(null)])).toEqual({
      response_latency_ms: null,
      interruptions: 0,
    });
    expect(aggregateLatency([])).toEqual({ response_latency_ms: null, interruptions: 0 });
  });

  test("every turn the interviewer cut short is counted, including a cut at zero seconds", () => {
    expect(
      aggregateLatency([turn(400, 75), turn(null, 0), turn(900), turn(300, 100)]).interruptions,
    ).toBe(3);
  });
});


describe("aggregateConfidence", () => {
  const turn = (transcriptConfidence: number | null) => ({ transcriptConfidence });

  test("the mean of the takes Whisper scored, to three decimals", () => {
    expect(aggregateConfidence([turn(-0.2), turn(-0.4), turn(-0.3)])).toBe(-0.3);
    expect(aggregateConfidence([turn(-0.1234), turn(-0.2)])).toBe(-0.162);
  });

  test("a typed turn is skipped rather than read as a perfect transcription", () => {
    expect(aggregateConfidence([turn(null), turn(-0.5), turn(null)])).toBe(-0.5);
  });

  test("an interview with nothing transcribed has no confidence at all", () => {
    expect(aggregateConfidence([])).toBe(null);
    expect(aggregateConfidence([turn(null), turn(null)])).toBe(null);
  });

  test("the value stays negative and unclamped", () => {
    const mumbled = aggregateConfidence([turn(-1.4), turn(-1.6)]);
    expect(mumbled).toBe(-1.5);
    expect(mumbled!).toBeLessThan(-1);
  });
});

describe("combineDelivery", () => {
  const TEXT = { wpm: 120, avg_pause_ms: 500, filler_count: 3 };

  const NO_ACOUSTICS = {
    pitch_variation: null,
    energy: null,
    mean_pitch_hz: null,
    jitter_local: null,
    shimmer_local: null,
    hnr_db: null,
    uptalk_pct: null,
    uptalk_statements: 0,
    uptalk_rising: 0,
    articulation_rate_sps: null,
    speech_rate_sps: null,
    phonation_ratio: null,
    trailing_off_pct: null,
    trailing_off_statements: 0,
    trailing_off_fading: 0,
  };

  const NO_CAMERA = {
    on_camera_pct: null,
    smile_pct: null,
    head_motion_dps: null,
    camera_turns: 0,
    slouch_pct: null,
    hands_to_face_pct: null,
    shoulder_tilt_deg: null,
    wrist_motion: null,
    posture_turns: 0,
  };

  test("absence survives the merge from all three halves", () => {
    expect(combineDelivery(TEXT, NO_ACOUSTICS, NO_CAMERA)).toEqual({
      wpm: 120,
      avg_pause_ms: 500,
      filler_count: 3,
      ...NO_ACOUSTICS,
      ...NO_CAMERA,
      response_latency_ms: null,
      interruptions: 0,
      transcriber_confidence: null,
    });
  });

  test("the extras are merged in when a caller measures them", () => {
    const merged = combineDelivery(TEXT, NO_ACOUSTICS, NO_CAMERA, {
      response_latency_ms: 940,
      interruptions: 2,
      transcriber_confidence: -0.42,
    });

    expect(merged.response_latency_ms).toBe(940);
    expect(merged.interruptions).toBe(2);
    expect(merged.transcriber_confidence).toBe(-0.42);
  });

  test("every measured figure keeps its name and its value", () => {
    const acoustics = {
      pitch_variation: 21.4,
      energy: 0.58,
      mean_pitch_hz: 118,
      jitter_local: 0.014,
      shimmer_local: 0.062,
      hnr_db: 19.2,
      uptalk_pct: 11.54,
      uptalk_statements: 26,
      uptalk_rising: 3,
      articulation_rate_sps: 4.61,
      speech_rate_sps: 3.42,
      phonation_ratio: 0.742,
      trailing_off_pct: 22.22,
      trailing_off_statements: 18,
      trailing_off_fading: 4,
    };
    const camera = {
      on_camera_pct: 84.2,
      smile_pct: 18.5,
      head_motion_dps: 6.1,
      camera_turns: 5,
      slouch_pct: 14.6,
      hands_to_face_pct: 5.2,
      shoulder_tilt_deg: 2.8,
      wrist_motion: 0.14,
      posture_turns: 5,
    };

    expect(combineDelivery(TEXT, acoustics, camera)).toEqual({
      wpm: 120,
      avg_pause_ms: 500,
      filler_count: 3,
      ...acoustics,
      ...camera,
      response_latency_ms: null,
      interruptions: 0,
      transcriber_confidence: null,
    });
  });
});
