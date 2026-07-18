import { describe, expect, test } from "bun:test";
import type { Difficulty, ExclusiveMode, InterviewConfig, InterviewSource } from "@repo/types";
import {
  ANSWER_CAP_MODEL,
  DIFFICULTIES,
  DIFFICULTY_META,
  MODE_META,
  QUESTION_BOUNDS,
  SOURCE_META,
  difficultyLabel,
  interviewLabel,
  perAnswerCapSeconds,
} from "./interviewMeta";

/**
 * Nothing here is mocked and nothing is stubbed: these three functions are the
 * arithmetic and the vocabulary that the room, the form and the prompt builder
 * all read off. A drift in any of them is silent — the interview still runs, it
 * just runs as something other than what was asked for.
 */

// The unions are restated as literals rather than read back off MODE_META /
// SOURCE_META. Deriving the expectation from the thing under test would make the
// coverage assertions below unable to fail.
const ALL_MODES: ExclusiveMode[] = [
  "topic_only",
  "cultural_only",
  "jd",
  "real",
  "weak_spots",
  "project",
];
const ALL_SOURCES: InterviewSource[] = ["resume", "topic", "cultural"];
const ALL_DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "extreme"];

describe("perAnswerCapSeconds", () => {
  /**
   * The formula is documented as exact, so it is pinned at values computed by
   * hand from ANSWER_CAP_MODEL rather than from the code. A retune of the
   * constants SHOULD break this — that is the point: the caps are frozen into
   * every session at creation, so a change to them is a change to the product.
   */
  test("matches the documented formula at hand-computed question counts", () => {
    // buildTerm(N) = ((300-60) / ((1/5)*N) - 2) / 0.15, floored to a clean 0:30.
    expect(perAnswerCapSeconds(32)).toBe(210); // 236.67s -> 3:30
    expect(perAnswerCapSeconds(40)).toBe(180); // 186.67s -> 3:00
    expect(perAnswerCapSeconds(50)).toBe(120); // 146.67s -> 2:00
    expect(perAnswerCapSeconds(64)).toBe(90); //  113.54s -> 1:30
  });

  test("gives every answer less time as the question count grows", () => {
    // The report build is one fixed budget shared across N clips. If this ever
    // stopped falling, a long interview would be handed a cap its own report
    // cannot finish inside — the failure mode the whole model exists to prevent.
    let prev = Infinity;
    for (let n = QUESTION_BOUNDS.min; n <= QUESTION_BOUNDS.max; n++) {
      const cap = perAnswerCapSeconds(n);
      expect(cap).not.toBeNull();
      expect(cap!).toBeLessThanOrEqual(prev);
      prev = cap!;
    }
  });

  test("holds every answer between the floor and the ceiling", () => {
    for (let n = QUESTION_BOUNDS.min; n <= QUESTION_BOUNDS.max; n++) {
      const cap = perAnswerCapSeconds(n)!;
      expect(cap).toBeLessThanOrEqual(ANSWER_CAP_MODEL.answerCeilingS);
      expect(cap).toBeGreaterThanOrEqual(ANSWER_CAP_MODEL.answerFloorS);
      expect(cap % 30).toBe(0);
    }
  });

  test("clamps short interviews to the flat transcription ceiling", () => {
    // Below N=32 the build budget is not the binding constraint — the 4-minute
    // product ceiling is. A regression that let buildTerm win here would hand a
    // 3-question interview a cap past the Whisper timeout.
    expect(perAnswerCapSeconds(QUESTION_BOUNDS.min)).toBe(ANSWER_CAP_MODEL.answerCeilingS);
    expect(perAnswerCapSeconds(8)).toBe(ANSWER_CAP_MODEL.answerCeilingS);
    expect(perAnswerCapSeconds(31)).toBe(ANSWER_CAP_MODEL.answerCeilingS);
  });

  test("refuses a question count whose answers would fall under the floor", () => {
    // 109 is the last count that still clears answerFloorS; 110 is the first
    // that cannot. Catches an off-by-one that would offer an interview whose
    // answers are too short to be worth recording.
    expect(perAnswerCapSeconds(109)).toBe(ANSWER_CAP_MODEL.answerFloorS);
    expect(perAnswerCapSeconds(110)).toBeNull();
  });
});

describe("difficultyLabel", () => {
  test.each([
    ["easy", "Easy"],
    ["medium", "Medium"],
    ["hard", "Hard"],
    ["extreme", "Extreme"],
  ])("labels %s as %s", (d, label) => {
    expect(difficultyLabel(d as Difficulty)).toBe(label);
  });

  test("covers every difficulty the form can pick", () => {
    expect([...DIFFICULTIES]).toEqual(ALL_DIFFICULTIES);
    expect(Object.keys(DIFFICULTY_META).sort()).toEqual([...ALL_DIFFICULTIES].sort());
    for (const d of ALL_DIFFICULTIES) {
      expect(DIFFICULTY_META[d].pitch.length).toBeGreaterThan(0);
      expect(DIFFICULTY_META[d].blurb.length).toBeGreaterThan(0);
    }
  });
});

describe("interviewLabel", () => {
  function cfg(over: Partial<InterviewConfig>): InterviewConfig {
    return {
      num_questions: 8,
      difficulty: "medium",
      sources: [],
      mode: null,
      allow_repeats: false,
      ...over,
    };
  }

  /**
   * MODE_META and SOURCE_META are indexed without a guard, so a union member
   * missing an entry is not a bad label — it is a TypeError thrown while
   * building the prompt, i.e. the interview never starts.
   */
  test("names every exclusive mode", () => {
    for (const mode of ALL_MODES) {
      const label = interviewLabel(cfg({ mode }));
      expect(label).toBeString();
      expect(label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(MODE_META).sort()).toEqual([...ALL_MODES].sort());
  });

  test("names every source", () => {
    for (const source of ALL_SOURCES) {
      const label = interviewLabel(cfg({ sources: [source] }));
      expect(label).toBeString();
      expect(label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(SOURCE_META).sort()).toEqual([...ALL_SOURCES].sort());
  });

  test("joins blended sources in the order they were picked", () => {
    expect(interviewLabel(cfg({ sources: ["cultural", "resume", "topic"] }))).toBe(
      "Cultural + Résumé + Topic",
    );
  });

  test("lets the mode win over sources, since a mode never blends", () => {
    // sources should be empty under a mode, but if a stale row somehow carries
    // both, the label must still name the mode — that is what the interviewer
    // was briefed with.
    expect(interviewLabel(cfg({ mode: "real", sources: ["resume"] }))).toBe("Real interview");
  });
});
