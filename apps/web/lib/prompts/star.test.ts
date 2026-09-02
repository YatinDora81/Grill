import { describe, expect, test } from "bun:test";
import type { DeliveryMetrics, StarBreakdown } from "@repo/types";
import type { ReportTurn } from "./report";
import { reportPrompt } from "./report";
import type { SessionContext } from "./questionGen";
import { STAR_MAX_SENTENCES, STAR_SYSTEM, starFactsBlock, starPrompt } from "./star";

const QUESTION = "Tell me about a time you disagreed with your manager.";
const SENTENCES = [
  "We were three weeks from a launch.",
  "I owned the migration.",
  "I wrote a one-page case and walked him through it.",
  "We shipped a week late with no incidents.",
];

describe("starPrompt", () => {
  test("the question and every sentence reach the model, numbered from one", () => {
    const p = starPrompt(QUESTION, SENTENCES);

    expect(p).toContain(`Question: ${QUESTION}`);
    expect(p).toContain("1. We were three weeks from a launch.");
    expect(p).toContain("2. I owned the migration.");
    expect(p).toContain("3. I wrote a one-page case and walked him through it.");
    expect(p).toContain("4. We shipped a week late with no incidents.");
  });

  test("it states the exact number of labels wanted, so a short reply is the model's error", () => {
    expect(starPrompt(QUESTION, SENTENCES)).toContain("exactly 4 entries");
    expect(starPrompt(QUESTION, ["Just the one."])).toContain("exactly 1 entries");
  });

  test("the sentences stay in the order they were said", () => {
    const p = starPrompt(QUESTION, SENTENCES);
    expect(p.indexOf("1. We were three")).toBeLessThan(p.indexOf("4. We shipped"));
  });

  test("the JSON shape is spelled out with the exact keys the schema parses", () => {
    const p = starPrompt(QUESTION, SENTENCES);
    for (const key of ["labels", "missing", "note"]) {
      expect(p).toContain(`"${key}"`);
    }
  });
});

describe("STAR_SYSTEM", () => {
  test("all five labels are defined, so the model never invents a sixth", () => {
    for (const label of ["S =", "T =", "A =", "R =", "other ="]) {
      expect(STAR_SYSTEM).toContain(label);
    }
  });

  test("it forbids judging the answer — this call splits, the report scores", () => {
    expect(STAR_SYSTEM).toContain("Do not judge how good the answer is");
    expect(STAR_SYSTEM).toContain("do not comment on tone or confidence");
  });

  test("it asks for JSON only, like every other structured prompt in the app", () => {
    expect(STAR_SYSTEM).toContain("Respond with JSON only");
  });
});

function breakdown(over: Partial<StarBreakdown> & { turn_index: number }): StarBreakdown {
  return {
    basis: "time",
    segments: [],
    share: { S: 62, T: 8, A: 26, R: 4, other: 0 },
    missing: [],
    note: "Most of this answer is scene-setting.",
    ...over,
  };
}

describe("starFactsBlock", () => {
  test("nothing measured produces no block at all, not an empty heading", () => {
    expect(starFactsBlock([])).toBe("");
  });

  test("each turn becomes one line of percentages the report can quote", () => {
    const block = starFactsBlock([breakdown({ turn_index: 3 })]);

    expect(block).toContain("turn 3 → S 62% · T 8% · A 26% · R 4% · other 0%");
    expect(block).toContain("missing: none");
    expect(block).toContain("facts");
  });

  test("absent parts are named, so the model can cite them instead of guessing", () => {
    const block = starFactsBlock([
      breakdown({ turn_index: 1, missing: ["R"], share: { S: 70, T: 10, A: 20, R: 0, other: 0 } }),
    ]);
    expect(block).toContain("missing: R");
  });

  test("every behavioral turn gets its own line", () => {
    const block = starFactsBlock([breakdown({ turn_index: 1 }), breakdown({ turn_index: 5 })]);
    expect(block.split("\n").filter((l) => l.startsWith("- turn "))).toHaveLength(2);
  });
});

test("the sentence cap matches the labels the schema will accept", () => {
  expect(STAR_MAX_SENTENCES).toBe(400);
});

const reportCtx: SessionContext = {
  sourceType: "resume",
  sourceText: "Senior engineer. Led the payments migration.",
  role: "Backend Engineer",
  config: {
    num_questions: 6,
    difficulty: "hard",
    sources: ["resume"],
    mode: null,
    allow_repeats: false,
  },
};

const reportTurns: ReportTurn[] = [
  {
    turn_index: 2,
    question: "Tell me about a time you disagreed with your manager.",
    question_type: "behavioral",
    transcript: SENTENCES.join(" "),
    answer_scores: { relevance: 7, correctness: 6, structure: 4, depth: 6, filler: 8 },
  },
];

const reportDelivery: DeliveryMetrics = {
  wpm: 128,
  avg_pause_ms: 380,
  filler_count: 4,
  pitch_variation: 20.1,
  energy: 0.54,
  mean_pitch_hz: 121,
  jitter_local: 0.013,
  shimmer_local: 0.058,
  hnr_db: 18.7,
  uptalk_pct: 8,
  uptalk_statements: 25,
  uptalk_rising: 2,
  on_camera_pct: 79.4,
  smile_pct: 14.2,
  head_motion_dps: 5.3,
  camera_turns: 4,
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

const LOPSIDED = breakdown({
  turn_index: 2,
  share: { S: 62, T: 8, A: 26, R: 4, other: 0 },
  missing: [],
  note: "Most of this answer is scene-setting; the outcome is one clause.",
});

describe("reportPrompt carries the STAR split", () => {
  test("the measured percentages reach the model verbatim", () => {
    const p = reportPrompt(reportCtx, reportTurns, reportDelivery, [LOPSIDED]);

    expect(p).toContain(starFactsBlock([LOPSIDED]));
    expect(p).toContain("turn 2 → S 62% · T 8% · A 26% · R 4% · other 0%");
  });

  test("the split is labelled fact and tied to that turn's improvements", () => {
    const p = reportPrompt(reportCtx, reportTurns, reportDelivery, [LOPSIDED]);

    expect(p).toContain("measured from each answer's own timestamps, facts");
    expect(p).toContain("A lopsided split is worth naming in that turn's improvements");
    expect(p).toContain("improvements");
  });

  test("it sits with the delivery facts, after the transcript it describes", () => {
    const p = reportPrompt(reportCtx, reportTurns, reportDelivery, [LOPSIDED]);

    expect(p.indexOf("Full interview:")).toBeLessThan(p.indexOf("STAR split"));
    expect(p.indexOf("STAR split")).toBeLessThan(p.indexOf("Measured delivery metrics"));
  });

  test("every behavioral turn's split travels, not just the first", () => {
    const p = reportPrompt(reportCtx, reportTurns, reportDelivery, [
      LOPSIDED,
      breakdown({ turn_index: 4, missing: ["R"] }),
    ]);

    expect(p).toContain("- turn 2 →");
    expect(p).toContain("- turn 4 →");
    expect(p).toContain("missing: R");
  });

  test("a technical-only interview reads exactly as it did before the feature", () => {
    const empty = reportPrompt(reportCtx, reportTurns, reportDelivery, []);
    const omitted = reportPrompt(reportCtx, reportTurns, reportDelivery);

    expect(empty).toBe(omitted);
    expect(empty).not.toContain("STAR split");
    expect(empty).not.toContain("\n\n\n");
  });
});
