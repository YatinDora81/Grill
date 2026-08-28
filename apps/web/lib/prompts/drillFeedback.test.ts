import { test, expect } from "bun:test";

import { DRILL_FEEDBACK_SYSTEM, drillFeedbackPrompt } from "./drillFeedback";

const QUESTION = "Tell me about a time you shipped something that broke in production.";
const ANSWER = "We pushed a migration on a Friday and the write path fell over for about an hour.";
const PREVIOUS = "Uh, we broke prod once. It was bad. We fixed it.";

test("the system prompt forbids judging anything the model cannot hear", () => {
  const lower = DRILL_FEEDBACK_SYSTEM.toLowerCase();
  expect(lower).toContain("only the words");
  expect(lower).toContain("cannot hear the audio");
  for (const banned of ["tone", "pace", "confidence", "nerves"]) {
    expect(lower).toContain(banned);
  }
  expect(lower).toContain("json only");
});

test("the prompt carries the question and the answer verbatim", () => {
  const prompt = drillFeedbackPrompt(QUESTION, ANSWER, null);
  expect(prompt).toContain(QUESTION);
  expect(prompt).toContain(ANSWER);
  expect(prompt).toContain("improvements");
  expect(prompt).toContain("better_line");
});

test("the previous best is included and labelled as something not to review", () => {
  const prompt = drillFeedbackPrompt(QUESTION, ANSWER, PREVIOUS);
  expect(prompt).toContain(PREVIOUS);
  expect(prompt).toContain("do not review it");
});

test("no previous attempt leaves no empty contrast block behind", () => {
  const prompt = drillFeedbackPrompt(QUESTION, ANSWER, null);
  expect(prompt).not.toContain("previous attempt");

  expect(drillFeedbackPrompt(QUESTION, ANSWER, "   ")).toBe(prompt);
});

test("an empty answer says so rather than leaving the model a blank", () => {
  const prompt = drillFeedbackPrompt(QUESTION, "   ", null);
  expect(prompt).toContain("(no clear answer was given)");
});

test("a very long typed answer is clipped, and the clip is marked", () => {
  const long = `${"word ".repeat(4_000)}end`;
  const prompt = drillFeedbackPrompt(QUESTION, long, null);

  expect(prompt.length).toBeLessThan(long.length);
  expect(prompt).toContain("…");
  expect(prompt).not.toContain("end");
  expect(prompt).toContain("better_line");
});

test("a long previous best is clipped harder than the answer being reviewed", () => {
  const longAnswer = "a ".repeat(4_000);
  const longPrevious = "b ".repeat(4_000);
  const prompt = drillFeedbackPrompt(QUESTION, longAnswer, longPrevious);

  const bs = (prompt.match(/b/g) ?? []).length;
  const as = (prompt.match(/a/g) ?? []).length;
  expect(bs).toBeLessThan(as);
});
