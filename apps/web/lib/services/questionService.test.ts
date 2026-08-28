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

let briefCalls: { company: unknown; role: unknown }[] = [];
let briefResult: { values: string[]; style_notes: string[] } | null = null;
let briefThrows = false;

mock.module("@/lib/services/companyBriefService", () => ({
  briefForQuestions: async (company: unknown, role: unknown) => {
    briefCalls.push({ company, role });
    if (briefThrows) throw new Error("cache unreachable");
    return briefResult;
  },
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

const BRIEF = { values: ["Users first"], style_notes: ["They ask for numbers"] };

function jd(config: Partial<InterviewConfig> = {}) {
  return ctx({
    mode: "jd",
    starred_hashes: undefined,
    company: "Stripe",
    job_title: "Staff Engineer",
    job_description: "Own the payments ledger.",
    ...config,
  });
}

function reset(result: typeof briefResult, throws = false) {
  briefCalls = [];
  briefResult = result;
  briefThrows = throws;
  stars = [];
}

test("hands a JD interview the cached brief for the company on the posting", async () => {
  reset(BRIEF);
  const inputs = await questionInputs(jd(), "u1");
  expect(inputs.companyBrief).toEqual(BRIEF);
  expect(briefCalls).toEqual([{ company: "Stripe", role: "Staff Engineer" }]);
});

test("falls back to the session role when the posting never named a title", async () => {
  reset(BRIEF);
  await questionInputs(jd({ job_title: undefined }), "u1");
  expect(briefCalls).toEqual([{ company: "Stripe", role: null }]);
});

test("never reads a brief for an interview that is not about a posting", async () => {
  for (const mode of ["real", "topic_only", "cultural_only", "weak_spots", "project"] as const) {
    reset(BRIEF);
    const inputs = await questionInputs(jd({ mode }), "u1");
    expect(briefCalls).toEqual([]);
    expect("companyBrief" in inputs).toBe(false);
  }
});

test("spends no lookup on a posting nobody's importer could name", async () => {
  reset(BRIEF);
  const inputs = await questionInputs(jd({ company: "   " }), "u1");
  expect(briefCalls).toEqual([]);
  expect("companyBrief" in inputs).toBe(false);
});

test("omits the brief when nobody has researched the company yet", async () => {
  reset(null);
  const inputs = await questionInputs(jd(), "u1");
  expect(briefCalls.length).toBe(1);
  expect("companyBrief" in inputs).toBe(false);
});

test("a failed cache read costs the candidate flavour, never their next question", async () => {
  reset(null, true);
  const inputs = await questionInputs(jd(), "u1");
  expect("companyBrief" in inputs).toBe(false);
  expect(inputs.askedBefore).toEqual(["An old question?"]);
});
