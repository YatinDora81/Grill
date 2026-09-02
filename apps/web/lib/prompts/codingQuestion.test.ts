import { describe, expect, test } from "bun:test";
import type { CodeSubmission, CodingQuestionPayload, InterviewConfig } from "@repo/types";
import { DIFFICULTY_META, PERSONA_GUARDRAIL } from "@/lib/interviewMeta";
import {
  CODE_REVIEW_SYSTEM,
  CODING_SYSTEM,
  codeFollowUpPrompt,
  codeReviewPrompt,
  codingQuestionPrompt,
} from "./codingQuestion";
import type { SessionContext } from "./questionGen";

function ctx(config: Partial<InterviewConfig> = {}): SessionContext {
  return {
    sourceType: "resume",
    sourceText: "Staff engineer. Shipped a billing ledger on Postgres.",
    role: "Backend Engineer",
    config: {
      num_questions: 4,
      difficulty: "hard",
      sources: ["resume"],
      mode: null,
      allow_repeats: false,
      round: "coding",
      problems: 2,
      ...config,
    },
  };
}

const PROBLEM: CodingQuestionPayload = {
  kind: "coding",
  title: "Merge the ledgers",
  prompt_markdown: "Read two sorted ledgers from stdin and print the merged ledger.",
  examples: [{ input: "1\n2", output: "1\n2" }],
  hidden_tests: [{ input: "", output: "" }],
  starter: { python: "import sys", javascript: "const line = readLine();" },
  complexity_target: "O(n) time",
};

const SUBMISSION: CodeSubmission = {
  language: "python",
  source: "print(sorted(sys.stdin))",
  results: [
    {
      index: 0,
      kind: "example",
      passed: true,
      stdout: "1\n2",
      stderr: "",
      expected: "1\n2",
      time_ms: 11,
      timed_out: false,
    },
    {
      index: 1,
      kind: "hidden",
      passed: false,
      stdout: "0",
      stderr: "IndexError: list index out of range",
      expected: "1",
      time_ms: 9,
      timed_out: false,
    },
  ],
  passed: 1,
  total: 2,
  keystrokes: {
    first_edit_ms: 4_200,
    edits: 90,
    chars_added: 640,
    chars_deleted: 80,
    longest_idle_ms: 31_000,
    runs: 3,
    run_timeline: [],
    submitted_at_ms: 900_000,
  },
  think_aloud_pct: 41.5,
  longest_silence_s: 62.4,
};

describe("the prompt that writes one problem", () => {
  test("the system contract keeps execution on stdin and stdout", () => {
    expect(CODING_SYSTEM).toContain("read ALL input from stdin");
    expect(CODING_SYSTEM).toContain("Never include the solution.");
  });

  test("the problem is pitched at the chosen difficulty, in that difficulty's words", () => {
    const prompt = codingQuestionPrompt(ctx({ difficulty: "extreme" }), {}, 0, 2);

    expect(prompt).toContain(DIFFICULTY_META.extreme.pitch);
    expect(prompt).toContain("Problem 1 of 2");
  });

  test("the persona brief travels with the problem", () => {
    expect(codingQuestionPrompt(ctx({ persona: "bar_raiser" }), {}, 0, 2)).toContain(
      PERSONA_GUARDRAIL,
    );
  });

  test("problems already asked are listed so they are not asked again", () => {
    const prompt = codingQuestionPrompt(
      ctx(),
      { askedBefore: ["Merge the ledgers", "Rate-limit the writes"] },
      1,
      2,
    );

    expect(prompt).toContain("Do not repeat these problems");
    expect(prompt).toContain("- Rate-limit the writes");
  });

  test("with nothing to go on it says so rather than inventing a candidate", () => {
    const prompt = codingQuestionPrompt(
      { sourceType: "resume", sourceText: "", role: null, config: ctx().config },
      {},
      0,
      1,
    );

    expect(prompt).toContain("(none — pick a general problem)");
    expect(prompt).toContain("Role: software engineer");
  });
});

describe("the prompt that grades the code", () => {
  test("the grader is told the measured results outrank its opinion", () => {
    expect(CODE_REVIEW_SYSTEM).toContain("Never override a\n  failing test with your own opinion.");
  });

  test("every failure carries what was expected and what came out", () => {
    const prompt = codeReviewPrompt(PROBLEM, SUBMISSION, "two pointers");

    expect(prompt).toContain("Measured results: 1/2 passed");
    expect(prompt).toContain("- hidden #1: FAIL (9 ms)");
    expect(prompt).toContain("expected: 1");
    expect(prompt).toContain("got: 0");
    expect(prompt).toContain("stderr: IndexError: list index out of range");
  });

  test("a passing test is not padded with expected-versus-got noise", () => {
    expect(codeReviewPrompt(PROBLEM, SUBMISSION, "")).toContain("- example #0: pass (11 ms)\n");
  });

  test("the measured talking share is handed over, and its absence is named", () => {
    expect(codeReviewPrompt(PROBLEM, SUBMISSION, "")).toContain("(41.5% of the time talking)");
    expect(
      codeReviewPrompt(PROBLEM, { ...SUBMISSION, think_aloud_pct: null }, ""),
    ).toContain("(unmeasured% of the time talking)");
  });
});

describe("the follow-up asked about the code they actually wrote", () => {
  test("it names the failing tests and carries the source", () => {
    const prompt = codeFollowUpPrompt(PROBLEM, SUBMISSION, "two pointers");

    expect(prompt).toContain("1/2 tests passed; failing: hidden #1");
    expect(prompt).toContain("print(sorted(sys.stdin))");
    expect(prompt).toContain('"question_type": "followup"');
  });

  test("an empty editor still earns a question", () => {
    const prompt = codeFollowUpPrompt(PROBLEM, null, "");

    expect(prompt).toContain("They submitted nothing.");
    expect(prompt).toContain("What they said while coding: (nothing)");
  });
});
