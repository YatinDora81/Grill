import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Turn } from "@repo/db";
import type {
  CodeSubmission,
  CodingQuestionPayload,
  InterviewConfig,
  TranscriptWord,
} from "@repo/types";
import type { SessionContext } from "@/lib/prompts/questionGen";

mock.module("server-only", () => ({}));

mock.module("@/lib/env", () => ({
  config: {
    auth: { passwordMinLength: 8 },
    interview: { defaultNumQuestions: 8 },
    video: { maxParts: 1_000 },
  },
}));

const PROBLEM = {
  kind: "coding",
  title: "Merge the ledgers",
  prompt_markdown:
    "Read two sorted ledgers from stdin, one number per line, and print the merged ledger.",
  examples: [{ input: "1\n2", output: "1\n2" }],
  hidden_tests: [
    { input: "", output: "" },
    { input: "1", output: "1" },
  ],
  starter: { python: "import sys", javascript: "const line = readLine();" },
  complexity_target: "O(n) time, O(1) extra space",
} satisfies CodingQuestionPayload;

const generateJson = mock(async (_schema: unknown, opts: { system: string }) => {
  if (opts.system.startsWith("You write ONE coding-interview problem")) {
    return { value: PROBLEM, raw: "", sources: [] };
  }
  return {
    value: { question: "Why is your merge O(n log n)?", question_type: "followup" },
    raw: "",
    sources: [],
  };
});
mock.module("@/lib/clients/llmJson", () => ({ generateJson }));

const questionInputs = mock(async () => ({ askedBefore: [] }));
mock.module("./questionService", () => ({ questionInputs }));

const {
  buildSubmission,
  codeTranscript,
  payloadOf,
  planNextCodingTurn,
  questionTextFor,
  spokenPart,
  spokenSeconds,
  turnsFor,
} = await import("./codingService");

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

function turn(t: Partial<Turn>): Turn {
  return {
    turnIndex: 0,
    question: "",
    questionType: "technical",
    questionPayload: null,
    transcript: null,
    codeSubmission: null,
    ...t,
  } as Turn;
}

const KEYSTROKES = {
  first_edit_ms: 4_200,
  edits: 90,
  chars_added: 640,
  chars_deleted: 80,
  longest_idle_ms: 31_000,
  runs: 3,
  run_timeline: [{ t_ms: 60_000, passed: 1, total: 2 }],
  submitted_at_ms: 20_000,
};

const RESULTS = [
  {
    index: 0,
    kind: "example" as const,
    passed: true,
    stdout: "1\n2",
    stderr: "",
    expected: "1\n2",
    time_ms: 12,
    timed_out: false,
  },
  {
    index: 0,
    kind: "hidden" as const,
    passed: false,
    stdout: "",
    stderr: "IndexError",
    expected: "1",
    time_ms: 9,
    timed_out: false,
  },
];

const payload = {
  language: "python" as const,
  source: "print(1)",
  results: RESULTS,
  keystrokes: KEYSTROKES,
};

beforeEach(() => {
  generateJson.mockClear();
  questionInputs.mockClear();
});

describe("speaking time taken off the word timings", () => {
  test("a gap under a second is still speaking; a longer one is the silence", () => {
    const words: TranscriptWord[] = [
      { word: "so", start: 0, end: 1 },
      { word: "merge", start: 1.8, end: 2.8 },
      { word: "done", start: 5.8, end: 6.8 },
    ];

    const { spoken, longestGap, lastEnd } = spokenSeconds(words);

    expect(spoken).toBeCloseTo(3.8, 5);
    expect(longestGap).toBeCloseTo(3, 5);
    expect(lastEnd).toBe(6.8);
  });

  test("the lead-in before the first word counts as a gap", () => {
    expect(spokenSeconds([{ word: "hm", start: 4, end: 4.5 }]).longestGap).toBe(4);
  });

  test("no words at all measures nothing rather than zero speech", () => {
    expect(spokenSeconds(null)).toEqual({ spoken: 0, longestGap: 0, lastEnd: 0 });
  });
});

describe("a submission built from the payload and the recording", () => {
  test("counts the passing tests and keeps every result", () => {
    const sub = buildSubmission(payload, null);

    expect(sub.passed).toBe(1);
    expect(sub.total).toBe(2);
    expect(sub.results).toHaveLength(2);
  });

  test("five spoken seconds of a twenty-second problem is a quarter of the time", () => {
    const words: TranscriptWord[] = [
      { word: "reading", start: 0, end: 2 },
      { word: "stdin", start: 2.5, end: 5 },
    ];

    const sub = buildSubmission(payload, words);

    expect(sub.think_aloud_pct).toBe(25);
  });

  test("the silence after the last word counts, so a quiet finish is measured", () => {
    const words: TranscriptWord[] = [
      { word: "reading", start: 0, end: 2 },
      { word: "stdin", start: 2.5, end: 5 },
    ];

    expect(buildSubmission(payload, words).longest_silence_s).toBe(15);
  });

  test("without audio the talking metrics are absent, not zero", () => {
    const sub = buildSubmission(payload, []);

    expect(sub.think_aloud_pct).toBeNull();
    expect(sub.longest_silence_s).toBeNull();
  });
});

describe("the transcript a coding turn is stored as", () => {
  const sub: CodeSubmission = buildSubmission(payload, null);

  test("what was said while coding survives the round trip", () => {
    const text = codeTranscript(sub, "  I'll merge with two pointers.  ");

    expect(spokenPart(text)).toBe("I'll merge with two pointers.");
  });

  test("silence round-trips as an explicit nothing", () => {
    expect(spokenPart(codeTranscript(sub, ""))).toBe("(nothing)");
  });

  test("a transcript that was never a coding turn has no spoken tail", () => {
    expect(spokenPart("We sharded by tenant.")).toBe("");
  });
});

describe("what comes next in a coding round", () => {
  test("an empty room opens with the first problem, payload and all", async () => {
    const planned = await planNextCodingTurn(ctx(), [], "user-1");

    expect(planned?.questionType).toBe("technical");
    expect(planned?.payload?.kind).toBe("coding");
    expect(planned?.question).toBe(questionTextFor(PROBLEM));
  });

  test("a finished problem is followed by a spoken follow-up with no payload", async () => {
    const turns = [
      turn({
        turnIndex: 0,
        questionPayload: PROBLEM,
        transcript: codeTranscript(buildSubmission(payload, null), "two pointers"),
        codeSubmission: buildSubmission(payload, null) as unknown as Turn["codeSubmission"],
      }),
    ];

    const planned = await planNextCodingTurn(ctx(), turns, "user-1");

    expect(planned).toEqual({
      question: "Why is your merge O(n log n)?",
      questionType: "followup",
      payload: null,
    });
  });

  test("both problems asked and answered ends the interview", async () => {
    const turns = [
      turn({ turnIndex: 0, questionPayload: PROBLEM, transcript: "code" }),
      turn({ turnIndex: 1, questionType: "followup", transcript: "spoken" }),
      turn({ turnIndex: 2, questionPayload: PROBLEM, transcript: "code" }),
      turn({ turnIndex: 3, questionType: "followup", transcript: "spoken" }),
    ];

    expect(await planNextCodingTurn(ctx(), turns, "user-1")).toBeNull();
  });

  test("an unanswered problem already on the board is not asked twice", async () => {
    const turns = [
      turn({ turnIndex: 0, questionPayload: PROBLEM, transcript: "code" }),
      turn({ turnIndex: 1, questionType: "followup", transcript: "spoken" }),
      turn({ turnIndex: 2, questionPayload: PROBLEM, transcript: null }),
    ];

    const planned = await planNextCodingTurn(ctx({ problems: 3 }), turns, "user-1");

    expect(planned?.payload?.kind).toBe("coding");
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
});

describe("the small shared arithmetic", () => {
  test("a round is two turns per problem, so every turn count still works", () => {
    expect(turnsFor(2)).toBe(4);
    expect(turnsFor(0)).toBe(2);
  });

  test("a stored payload reads back off the turn; junk reads back as nothing", () => {
    expect(payloadOf(turn({ questionPayload: PROBLEM }))?.kind).toBe("coding");
    expect(payloadOf(turn({ questionPayload: { kind: "coding" } }))).toBeNull();
    expect(payloadOf(turn({}))).toBeNull();
  });

  test("the plain-text rendering leads with the title so history still reads", () => {
    expect(questionTextFor(PROBLEM).startsWith("Merge the ledgers\n\n")).toBe(true);
  });
});
