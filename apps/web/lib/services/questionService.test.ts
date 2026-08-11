import { expect, mock, test } from "bun:test";
import type { InterviewConfig } from "@repo/types";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

mock.module("@/lib/clients/llmJson", () => ({
  generateJson: async () => ({ value: { question: "Q?", question_type: "behavioral" } }),
}));

let stars: { question: string; questionHash: string }[] = [];

mock.module("@/lib/db/repo", () => ({
  listAskedQuestions: async () => ["An old question?"],
  listWeakTurns: async () => [],
  listStarredQuestions: async () => stars,
}));

const { questionInputs } = await import("./questionService");
const { AppError } = await import("@/lib/errors");

const HASH = "a".repeat(64);

function ctx(config: Partial<InterviewConfig> = {}) {
  return {
    sourceType: "resume" as const,
    sourceText: "Staff engineer.",
    role: null,
    config: {
      num_questions: 6,
      difficulty: "hard",
      sources: [],
      mode: "starred",
      allow_repeats: false,
      starred_hashes: [HASH],
      ...config,
    } as InterviewConfig,
  };
}

test("refuses to start a drill whose stars are all gone", async () => {
  stars = [];
  const err = await questionInputs(ctx(), "u1", { requireStars: true }).catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as InstanceType<typeof AppError>).code).toBe("no_starred_questions");
});

test("lets a running drill finish adaptively when its stars vanish mid-flow", async () => {
  stars = [];
  const inputs = await questionInputs(ctx(), "u1");
  expect(inputs.fixedQuestions).toEqual([]);
  expect(inputs.askedBefore).toEqual(["An old question?"]);
});

test("still hands back the surviving stars in the user's order", async () => {
  stars = [{ question: "Q one?", questionHash: HASH }];
  const inputs = await questionInputs(ctx(), "u1", { requireStars: true });
  expect(inputs.fixedQuestions).toEqual(["Q one?"]);
});
