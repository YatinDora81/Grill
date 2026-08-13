import { expect, mock, test } from "bun:test";
import type { QuestionBankContext } from "@/lib/prompts/questionBank";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

/**
 * The mock model: hands back whatever the current script says, one call at a
 * time. Each test sets the script; the service under test decides how many
 * calls it makes — which is exactly what these tests are measuring.
 */
let script: { questions: { question: string; question_type: string }[] }[] = [];
let calls = 0;
let prompts: string[] = [];

mock.module("@/lib/clients/llmJson", () => ({
  generateJson: async (_schema: unknown, opts: { prompt: string }) => {
    prompts.push(opts.prompt);
    const next = script[Math.min(calls, script.length - 1)];
    calls++;
    if (!next) throw new Error("script exhausted");
    // The real generateJson Zod-validates; the service imports the schema and
    // hands it over, so parse through it here rather than bypassing it —
    // otherwise these tests would pass a shape the real pipeline rejects.
    const { questionBatchResponseSchema } = await import("@/lib/schemas");
    return { value: questionBatchResponseSchema.parse(next), raw: JSON.stringify(next) };
  },
}));

const { generateQuestionSet } = await import("./questionBankService");
const { AppError } = await import("@/lib/errors");

const qs = (...texts: string[]) => ({
  questions: texts.map((question) => ({ question, question_type: "technical" })),
});

function reset(...s: typeof script) {
  script = s;
  calls = 0;
  prompts = [];
}

const CTX: QuestionBankContext = {
  source: "topic",
  sourceText: "PostgreSQL indexing",
  role: null,
  difficulty: "hard",
};

test("a small set is one call, returned in the model's order", async () => {
  reset(qs("A?", "B?", "C?"));
  const out = await generateQuestionSet(CTX, 3);
  expect(calls).toBe(1);
  expect(out.map((q) => q.question)).toEqual(["A?", "B?", "C?"]);
});

test("large sets are chunked, and later chunks are told what came before", async () => {
  reset(
    qs(...Array.from({ length: 10 }, (_, i) => `Q${i}?`)),
    qs("Q10?", "Q11?"),
  );
  const out = await generateQuestionSet(CTX, 12);
  expect(calls).toBe(2);
  expect(out).toHaveLength(12);
  // The second prompt carries the first chunk as a do-not-repeat list.
  expect(prompts[1]).toContain("Q0?");
  expect(prompts[1]).toContain("must not contain");
});

test("near-duplicates are dropped and topped up rather than delivered twice", async () => {
  // "b?" vs "  B?" is one question under questionHash's normalisation. The
  // batch schema trims on the way in, so the survivor is stored trimmed.
  reset(qs("A?", "  b?", "B?"), qs("C?"));
  const out = await generateQuestionSet(CTX, 3);
  expect(out.map((q) => q.question)).toEqual(["A?", "b?", "C?"]);
  expect(calls).toBe(2);
});

test("a model that only ever rephrases fails out as 503, not a hang", async () => {
  reset(qs("Same?"), qs("same?"), qs("SAME?"), qs("  same?"), qs("same ?"));
  const err = await generateQuestionSet(CTX, 3).catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as InstanceType<typeof AppError>).status).toBe(503);
  expect((err as InstanceType<typeof AppError>).code).toBe("generation_short");
});

test("extra questions past the asked-for count are cut, not delivered", async () => {
  reset(qs("A?", "B?", "C?", "D?", "E?"));
  const out = await generateQuestionSet(CTX, 2);
  expect(out).toHaveLength(2);
});
