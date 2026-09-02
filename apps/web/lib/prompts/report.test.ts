import { test, expect } from "bun:test";
import type { DeliveryMetrics } from "@repo/types";
import { REPORT_SYSTEM, reportPrompt } from "./report";
import type { ReportTurn } from "./report";
import type { SessionContext } from "./questionGen";

const ctx: SessionContext = {
  sourceType: "resume",
  sourceText: "Staff engineer. Shipped a billing ledger on Postgres.",
  role: "Backend Engineer",
  config: {
    num_questions: 8,
    difficulty: "hard",
    sources: ["resume"],
    mode: null,
    allow_repeats: false,
  },
};

const turns: ReportTurn[] = [
  {
    turn_index: 0,
    question: "How did you shard the ledger?",
    question_type: "technical",
    transcript: "We split it by tenant and kept a global sequence for invoices.",
    answer_scores: { relevance: 8, correctness: 7, structure: 6, depth: 7, filler: 9 },
  },
];

const ALL_LABELS = [
  "pace",
  "average pause",
  "filler words",
  "pitch variation",
  "energy",
  "mean pitch",
  "jitter",
  "shimmer",
  "voice clarity (HNR)",
  "articulation rate",
  "speech rate",
  "phonation ratio",
  "transcriber confidence",
  "uptalk",
  "trailing off",
  "time looking at the camera",
  "time visibly smiling",
  "head movement",
  "time to first word",
];

const POSTURE_LABELS = [
  "time slouched below the calibrated pose",
  "hands near the face",
  "shoulder tilt",
  "wrist motion",
];

function readDelivery(
  p: string,
  extra: readonly string[] = [],
): { measured: Record<string, string>; absent: string[] } {
  const head = p.slice(p.indexOf("Measured delivery metrics (facts):"));
  const measured: Record<string, string> = {};
  for (const line of head.split("\n\n")[0]!.split("\n").slice(1)) {
    const [label, ...rest] = line.replace(/^- /, "").split(": ");
    measured[label!.replace(" (median)", "")] = rest.join(": ");
  }

  const match = /NOT MEASURED — ([^.]+)\./.exec(p);
  const absent = match ? match[1]!.split(", ") : [];

  expect([...Object.keys(measured), ...absent].sort()).toEqual(
    [...ALL_LABELS, ...extra].sort(),
  );
  return { measured, absent };
}

const FULL: DeliveryMetrics = {
  wpm: 132,
  avg_pause_ms: 410,
  filler_count: 6,
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
  response_latency_ms: 900,
  interruptions: 0,
  articulation_rate_sps: 4.32,
  speech_rate_sps: 3.11,
  phonation_ratio: 0.72,
  trailing_off_pct: 25,
  trailing_off_statements: 8,
  trailing_off_fading: 2,
  transcriber_confidence: -0.28,
  slouch_pct: 18.2,
  hands_to_face_pct: 6.5,
  shoulder_tilt_deg: 3.4,
  wrist_motion: 0.12,
  posture_turns: 5,
};

const TYPED: DeliveryMetrics = {
  wpm: 0,
  avg_pause_ms: 0,
  filler_count: 2,
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
  response_latency_ms: null,
  interruptions: 0,
  articulation_rate_sps: null,
  speech_rate_sps: null,
  phonation_ratio: null,
  trailing_off_pct: null,
  trailing_off_statements: 0,
  trailing_off_fading: 0,
  transcriber_confidence: null,
  slouch_pct: null,
  hands_to_face_pct: null,
  shoulder_tilt_deg: null,
  wrist_motion: null,
  posture_turns: 0,
};

const NO_ACOUSTICS: DeliveryMetrics = {
  ...FULL,
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

const NO_CAMERA: DeliveryMetrics = {
  ...FULL,
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

const build = (d: DeliveryMetrics) => reportPrompt(ctx, turns, d);

const liveCtx: SessionContext = { ...ctx, config: { ...ctx.config, live: true } };

test("a typed interview is never handed a pace or a pitch to grade", () => {
  const p = build(TYPED);

  expect(p).not.toMatch(/\b0 wpm\b/);
  expect(p).not.toContain('"wpm": 0');
  expect(p).not.toMatch(/pace: /);
  expect(p).not.toMatch(/average pause: /);
  expect(p).not.toMatch(/pitch variation: /);
  expect(p).not.toMatch(/\bnull\b/);

  const { measured, absent } = readDelivery(p);
  expect(Object.keys(measured)).toEqual(["filler words"]);
  expect(absent[0]).toBe("pace");
  expect(absent.slice(-3)).toEqual([
    "time looking at the camera",
    "time visibly smiling",
    "head movement",
  ]);

  expect(p).toContain("typed their answers rather than speaking");
  expect(p).toContain("The camera was off or blocked");
  expect(p).toContain("Treat these as absent, not as zero");
});

test("a live conversation is never described to the model as a typed one", () => {
  const p = reportPrompt(liveCtx, turns, TYPED);

  expect(p).toContain(
    "This was a live spoken conversation: no audio was recorded, so pace, tone, latency and camera were not measured.",
  );
  expect(p).not.toContain("typed their answers");
  expect(p).not.toContain("The camera was off or blocked");
  expect(p).toContain("Treat these as absent, not as zero");
  expect(readDelivery(p).absent[0]).toBe("pace");
});

test("filler words survive typed answers, because they are counted from the text", () => {
  const p = build(TYPED);

  expect(p).toContain("Measured delivery metrics (facts):\n- filler words: 2");
  expect(p.slice(p.indexOf("NOT MEASURED"))).not.toContain("filler");
});

test("a failed acoustic service costs the acoustics and nothing else", () => {
  const p = build(NO_ACOUSTICS);
  const { measured, absent } = readDelivery(p, POSTURE_LABELS);

  expect(measured["pace"]).toBe("132 wpm");
  expect(measured["average pause"]).toBe("410 ms");
  expect(measured["filler words"]).toBe("6");

  expect(absent).toEqual([
    "pitch variation",
    "energy",
    "mean pitch",
    "jitter",
    "shimmer",
    "voice clarity (HNR)",
    "articulation rate",
    "speech rate",
    "phonation ratio",
    "uptalk",
    "trailing off",
  ]);
  expect(measured["time looking at the camera"]).toBe("84.2%");

  expect(p).toContain("The audio analysis was unavailable for this session.");
  expect(p).not.toContain("typed their answers");
  expect(p).not.toContain("The camera was off or blocked");
});

test("a camera that never opened is named absent, and blamed on the camera", () => {
  const p = build(NO_CAMERA);
  const { measured, absent } = readDelivery(p);

  expect(absent).toEqual(["time looking at the camera", "time visibly smiling", "head movement"]);
  expect(measured["uptalk"]).toBe("3 of 26 statements ended on a rising pitch");
  expect(p).toContain("The camera was off or blocked, so there is no on-camera measurement.");
  expect(p).not.toContain("audio analysis was unavailable");
  expect(p).not.toContain("typed their answers");
});

test("a fully measured session is told about no absence at all", () => {
  const p = build(FULL);

  expect(p).not.toContain("NOT MEASURED");
  expect(p).not.toContain("audio analysis was unavailable");
  expect(p).not.toContain("The camera was off or blocked");

  const { measured, absent } = readDelivery(p, POSTURE_LABELS);
  expect(absent).toEqual([]);
  expect(measured).toEqual({
    pace: "132 wpm",
    "average pause": "410 ms",
    "filler words": "6",
    "pitch variation": "21.4",
    energy: "0.58",
    "mean pitch": "118",
    jitter: "0.014",
    shimmer: "0.062",
    "voice clarity (HNR)": "19.2 dB",
    "articulation rate": "4.32 syllables/s of speaking time",
    "speech rate": "3.11 syllables/s including pauses",
    "phonation ratio": "0.72 (share of the time the candidate was actually voicing)",
    "transcriber confidence":
      "-0.28 (mean log-probability; closer to 0 is clearer to the transcriber)",
    uptalk: "3 of 26 statements ended on a rising pitch",
    "trailing off": "2 of 8 statements ended at least 6 dB quieter than their body",
    "time looking at the camera": "84.2%",
    "time visibly smiling": "18.5%",
    "head movement": "6.1 deg/s",
    "time slouched below the calibrated pose": "18.2%",
    "hands near the face": "6.5%",
    "shoulder tilt": "3.4°",
    "wrist motion": "0.12 shoulder-widths/s",
    "time to first word": "900 ms — from the end of the question to the first word spoken",
  });
  expect(p).not.toContain("11.54");
});

test("posture is handed over only when a calibrated pose actually measured it", () => {
  const p = build({
    ...FULL,
    slouch_pct: null,
    hands_to_face_pct: null,
    shoulder_tilt_deg: null,
    wrist_motion: null,
    posture_turns: 0,
  });

  expect(p).not.toContain("slouched");
  expect(p).not.toContain("shoulder tilt");
  expect(readDelivery(p).absent).toEqual([]);
});

test("a mumbled take is a log-probability, never a mood", () => {
  const p = build({ ...FULL, transcriber_confidence: -0.91 });

  expect(p).toContain(
    "- transcriber confidence: -0.91 (mean log-probability; closer to 0 is clearer to the transcriber)",
  );
  expect(REPORT_SYSTEM).toContain("never as mood, nerves or confidence.");
});

test("trailing off with nothing to judge is absent, not a measured zero", () => {
  const p = build({
    ...FULL,
    trailing_off_pct: null,
    trailing_off_statements: 0,
    trailing_off_fading: 0,
  });

  expect(p).not.toContain("0 of 0 statements ended at least");
  expect(readDelivery(p, POSTURE_LABELS).absent).toEqual(["trailing off"]);
});

test("uptalk with nothing judgeable is absent, not a measured zero", () => {
  const p = build({ ...FULL, uptalk_pct: null, uptalk_statements: 0, uptalk_rising: 0 });
  const { measured, absent } = readDelivery(p, POSTURE_LABELS);

  expect(measured["uptalk"]).toBeUndefined();
  expect(absent).toEqual(["uptalk"]);
  expect(p).not.toContain("0 of 0");
});

test("silence in the middle of speech is reported, but a zero-pause zero is not", () => {
  const p = build({ ...TYPED, filler_count: 0 });
  expect(p).not.toContain("average pause: 0 ms");
  expect(p).toContain("- filler words: 0");
});

test("the system prompt tells the model that NOT MEASURED means absent, not zero", () => {
  const flat = REPORT_SYSTEM.replace(/\s+/g, " ");

  expect(flat).toContain(
    "Anything listed as NOT MEASURED is absent, not zero — say nothing about it, and never score it.",
  );
  expect(flat).toContain("NEVER infer tone/confidence from the transcript text");
  expect(flat).toContain('never as "nervous"');
  expect(flat).toContain('never as "confidence" or "engagement"');
});

test("the report prompt asks for per-question possible answers and improvements", () => {
  const p = build(FULL);
  expect(p).toContain("question_feedback");
  expect(p).toContain("possible_answers");
  expect(p).toContain("improvements");
});

test("the measured gap to the first word is handed over as a fact, with its meaning", () => {
  const p = build(FULL);

  expect(p).toContain(
    "- time to first word (median): 900 ms — from the end of the question to the first word spoken",
  );
  expect(REPORT_SYSTEM).toContain(
    "Time to first word is a measured gap, not a judgement about preparation",
  );
});

test("an interview with no word timings lists the gap as absent, not as an instant answer", () => {
  const p = build({ ...FULL, response_latency_ms: null });
  const { measured, absent } = readDelivery(p, POSTURE_LABELS);

  expect(measured["time to first word"]).toBeUndefined();
  expect(absent).toEqual(["time to first word"]);
  expect(p).not.toContain("audio analysis was unavailable");
  expect(p).not.toContain("The camera was off or blocked");
});

test("being cut off is reported as a count, and silence about it when it never happened", () => {
  expect(build({ ...FULL, interruptions: 2 })).toContain(
    "- the interviewer cut the candidate off 2 time(s) for running long",
  );
  expect(build(FULL)).not.toContain("cut the candidate off");
});
