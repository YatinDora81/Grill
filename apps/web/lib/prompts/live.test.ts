import { expect, test } from "bun:test";
import type { InterviewConfig } from "@repo/types";
import type { SessionContext } from "./questionGen";
import { LIVE_CLOSING, liveSystemInstruction } from "./live";

const config = (over: Partial<InterviewConfig> = {}): InterviewConfig => ({
  num_questions: 6,
  difficulty: "hard",
  persona: "terse_staff",
  sources: ["resume"],
  mode: null,
  allow_repeats: false,
  live: true,
  ...over,
});

const ctx = (over: Partial<InterviewConfig> = {}): SessionContext => ({
  sourceType: "resume",
  sourceText: "Ten years on payments infrastructure.",
  role: "Staff engineer",
  config: config(over),
});

const OPENER = "The ledger reconciliation you rebuilt — what was wrong with the old one?";

test("the opener is quoted verbatim, with the count and the closing line", () => {
  const out = liveSystemInstruction(ctx(), OPENER, 6);

  expect(out).toContain(`"${OPENER}"`);
  expect(out).toContain("Ask 6 questions in total");
  expect(out).toContain(LIVE_CLOSING);
});

test("the framing carries the persona and the difficulty pitch but never asks for JSON", () => {
  const out = liveSystemInstruction(ctx(), OPENER, 6);

  expect(out).toContain("technical interviewer");
  expect(out).toContain("minimal, dry, zero pleasantries");
  expect(out).toContain("Difficulty: Hard.");
  expect(out).not.toContain("JSON");
  expect(out).not.toContain("code fences");
});

test("a cultural-only live interview keeps the cultural framing", () => {
  const out = liveSystemInstruction(ctx({ mode: "cultural_only", sources: [] }), OPENER, 4);

  expect(out).toContain("culture-fit");
  expect(out).toContain("Ask 4 questions in total");
  expect(out).not.toContain("JSON");
});

test("the material blocks are sliced in, and their absence is said plainly", () => {
  const withJd = liveSystemInstruction(
    ctx({ mode: "jd", sources: [], job_description: "We need someone who owns settlement." }),
    OPENER,
    6,
  );
  expect(withJd).toContain("Job description:");
  expect(withJd).toContain("We need someone who owns settlement.");
  expect(withJd).toContain("Résumé:");

  const bare = liveSystemInstruction(
    { sourceType: "topic", sourceText: "", role: null, config: config({ mode: "topic_only", sources: [], topic: "" }) },
    OPENER,
    3,
  );
  expect(bare).toContain("(none — keep the questions general)");
});
