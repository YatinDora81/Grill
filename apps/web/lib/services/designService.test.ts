import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Turn } from "@repo/db";
import type { DesignQuestionPayload, InterviewConfig } from "@repo/types";
import type { SessionContext } from "@/lib/prompts/questionGen";

mock.module("server-only", () => ({}));

mock.module("@/lib/env", () => ({
  config: {
    auth: { passwordMinLength: 8 },
    interview: { defaultNumQuestions: 8 },
    video: { maxParts: 1_000 },
  },
}));

const PROMPT = {
  kind: "design",
  title: "A ledger for the till",
  prompt_markdown:
    "Design the write path for a point-of-sale ledger that every store reads back within a second.",
  requirements: ["every sale is durable", "reads within one second", "no double charges"],
  scale: "2M daily users, 8k writes/s",
  focus: ["partitioning", "failure handling"],
} satisfies DesignQuestionPayload;

const REVIEW = {
  summary: "A gateway in front of Kafka, a ledger service and one Postgres primary.",
  components: ["api gateway", "kafka", "ledger service", "postgres"],
  missing: ["no read replica", "no idempotency key"],
  single_points_of_failure: ["the single postgres primary"],
  scale_concerns: ["8k writes/s on one primary"],
  follow_up_question: "What happens to the ledger service when that single Postgres primary fails?",
};

const generateJson = mock(async (_schema: unknown, opts: { system: string }) => {
  if (opts.system.startsWith("You write ONE system-design interview prompt")) {
    return { value: PROMPT, raw: "", sources: [] };
  }
  return {
    value: {
      ...REVIEW,
      scores: { relevance: 8, correctness: 6, structure: 7, depth: 5, filler: 8 },
    },
    raw: "",
    sources: [],
  };
});
mock.module("@/lib/clients/llmJson", () => ({ generateJson }));

const questionInputs = mock(async () => ({ askedBefore: [] }));
mock.module("./questionService", () => ({ questionInputs }));

const { designTranscript, firstDesignTurn, planNextDesignTurn, reviewDesign, spokenPart } =
  await import("./designService");
const { questionTextFor } = await import("./codingService");

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
      round: "design",
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
    designReview: null,
    ...t,
  } as Turn;
}

const PNG = new Uint8Array([137, 80, 78, 71]);

beforeEach(() => {
  generateJson.mockClear();
  questionInputs.mockClear();
});

describe("reviewing the board", () => {
  test("the PNG goes to the model as an inline image, not as words", async () => {
    await reviewDesign(PROMPT, PNG, "I put a queue in front of the ledger.");

    const opts = generateJson.mock.calls[0]![1] as unknown as {
      images?: { mimeType: string; data: string }[];
      temperature: number;
    };
    expect(opts.images).toEqual([
      { mimeType: "image/png", data: Buffer.from(PNG).toString("base64") },
    ]);
    expect(opts.temperature).toBe(0.2);
  });

  test("the review and the scores come back apart, so the rubric keeps working", async () => {
    const { review, scores } = await reviewDesign(PROMPT, PNG, "");

    expect(review.components).toEqual(REVIEW.components);
    expect(review.follow_up_question).toBe(REVIEW.follow_up_question);
    expect(scores).toEqual({ relevance: 8, correctness: 6, structure: 7, depth: 5, filler: 8 });
    expect("scores" in review).toBe(false);
  });
});

describe("the transcript a design turn is stored as", () => {
  test("what was said at the board survives the round trip", () => {
    const text = designTranscript(REVIEW, "  I sharded the ledger by store.  ");

    expect(text).toContain("[design] components: api gateway, kafka, ledger service, postgres");
    expect(text).toContain("SPOF: the single postgres primary");
    expect(spokenPart(text)).toBe("I sharded the ledger by store.");
  });

  test("silence round-trips as an explicit nothing", () => {
    expect(spokenPart(designTranscript(REVIEW, ""))).toBe("(nothing)");
  });

  test("an empty list reads as none rather than as a gap", () => {
    const text = designTranscript({ ...REVIEW, missing: [] }, "");

    expect(text).toContain("missing: none");
  });
});

describe("what comes next in a design round", () => {
  test("an empty room opens with the first prompt, payload and all", async () => {
    const planned = await planNextDesignTurn(ctx(), [], "user-1");

    expect(planned?.questionType).toBe("technical");
    expect(planned?.payload?.kind).toBe("design");
    expect(planned?.question).toBe(questionTextFor(PROMPT));
  });

  test("the follow-up is the one the reviewer already wrote — no second model call", async () => {
    const turns = [
      turn({
        turnIndex: 0,
        questionPayload: PROMPT,
        transcript: designTranscript(REVIEW, "two pointers"),
        designReview: REVIEW as unknown as Turn["designReview"],
      }),
    ];

    const planned = await planNextDesignTurn(ctx(), turns, "user-1");

    expect(planned).toEqual({
      question: REVIEW.follow_up_question,
      questionType: "followup",
      payload: null,
    });
    expect(generateJson).not.toHaveBeenCalled();
  });

  test("a board with no stored review still gets a follow-up, about the scale it was given", async () => {
    const turns = [turn({ turnIndex: 0, questionPayload: PROMPT, transcript: "[design] ..." })];

    const planned = await planNextDesignTurn(ctx(), turns, "user-1");

    expect(planned?.question).toBe(
      "Walk me through what happens when 2M daily users, 8k writes/s doubles.",
    );
    expect(generateJson).not.toHaveBeenCalled();
  });

  test("both prompts asked and answered ends the interview", async () => {
    const turns = [
      turn({ turnIndex: 0, questionPayload: PROMPT, transcript: "[design] ..." }),
      turn({ turnIndex: 1, questionType: "followup", transcript: "spoken" }),
      turn({ turnIndex: 2, questionPayload: PROMPT, transcript: "[design] ..." }),
      turn({ turnIndex: 3, questionType: "followup", transcript: "spoken" }),
    ];

    expect(await planNextDesignTurn(ctx(), turns, "user-1")).toBeNull();
  });

  test("an unanswered board already on the wall is not asked twice", async () => {
    const turns = [
      turn({ turnIndex: 0, questionPayload: PROMPT, transcript: "[design] ..." }),
      turn({ turnIndex: 1, questionType: "followup", transcript: "spoken" }),
      turn({ turnIndex: 2, questionPayload: PROMPT, transcript: null }),
    ];

    const planned = await planNextDesignTurn(ctx({ problems: 3 }), turns, "user-1");

    expect(planned?.payload?.kind).toBe("design");
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
});

describe("the opening prompt", () => {
  test("comes back as a technical turn with a plain-text rendering for the history", async () => {
    const first = await firstDesignTurn(ctx(), { askedBefore: [] });

    expect(first.question_type).toBe("technical");
    expect(first.payload.kind).toBe("design");
    expect(first.question.startsWith("A ledger for the till\n\n")).toBe(true);
  });
});
