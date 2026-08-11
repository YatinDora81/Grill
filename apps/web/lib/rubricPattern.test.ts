import { test, expect } from "bun:test";
import type { AnswerScores } from "@repo/types";
import { DIMENSIONS, PATTERN, isAnswerScores, worstDimension } from "./rubricPattern";

const s = (p: Partial<AnswerScores> = {}): AnswerScores => ({
  relevance: 8,
  correctness: 8,
  structure: 8,
  depth: 8,
  filler: 8,
  ...p,
});

test("no answers, no pattern", () => {
  expect(worstDimension([])).toBeNull();
});

test("the lowest mean wins, not the lowest single answer", () => {
  const scores = [s({ depth: 1 }), s({ structure: 5 }), s({ structure: 4 })];
  expect(worstDimension(scores)).toBe("structure");
});

test("filler is not inverted — a low filler score is the worst habit", () => {
  expect(worstDimension([s({ filler: 2 })])).toBe("filler");
});

test("a tie goes to the dimension declared first", () => {
  const scores = [s({ relevance: 3, depth: 3 })];
  expect(worstDimension(scores)).toBe("relevance");
});

test("every dimension has a sentence naming it", () => {
  for (const d of DIMENSIONS) {
    expect(PATTERN[d]).toContain(d);
    expect(PATTERN[d].startsWith("The thing costing you the most is")).toBe(true);
  }
});

test("an opaque JSON blob only passes when all five numbers are real", () => {
  expect(isAnswerScores(s())).toBe(true);
  expect(isAnswerScores(null)).toBe(false);
  expect(isAnswerScores({})).toBe(false);
  expect(isAnswerScores({ ...s(), depth: "8" })).toBe(false);
  expect(isAnswerScores({ ...s(), filler: NaN })).toBe(false);
  expect(isAnswerScores({ ...s(), relevance: Infinity })).toBe(false);
});
