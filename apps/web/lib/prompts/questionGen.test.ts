import { test, expect } from "bun:test";
import type { InterviewConfig } from "@repo/types";
import {
  culturalOnly,
  firstQuestionPrompt,
  followUpPrompt,
  questionSystem,
  stageFor,
} from "./questionGen";
import type { SessionContext } from "./questionGen";

/**
 * The angle is the most specific instruction in the prompt, and the most
 * specific instruction is the one the model obeys — so an angle drawn from the
 * wrong pool silently overrides the brief above it. These tests are about which
 * pool each interview shape is allowed to draw from; the draw is random, so
 * every pool is sampled to exhaustion rather than asserted on one roll.
 */

function ctx(config: Partial<InterviewConfig>): SessionContext {
  return {
    sourceType: "resume",
    sourceText: "Staff engineer. Shipped a billing ledger on Postgres.",
    role: "Backend Engineer",
    config: {
      num_questions: 8,
      difficulty: "hard",
      sources: [],
      mode: null,
      allow_repeats: false,
      ...config,
    },
  };
}

/** Enough rolls that an 8-entry pool is drawn dry many times over. */
const ROLLS = 600;

function sample(build: () => string, re: RegExp): Set<string> {
  const seen = new Set<string>();
  for (let i = 0; i < ROLLS; i++) {
    const m = build().match(re);
    if (m?.[1]) seen.add(m[1].trim());
  }
  return seen;
}

const OPEN_ON = /^Open on: (.+)$/m;
const LEAN_TOWARD = /lean toward: (.+)/;

const openers = (c: Partial<InterviewConfig>) => sample(() => firstQuestionPrompt(ctx(c)), OPEN_ON);

const nextAreas = (c: Partial<InterviewConfig>) =>
  sample(
    () => followUpPrompt(ctx(c), [{ question: "Q1", answer: "A1" }], 3),
    LEAN_TOWARD,
  );

const disjoint = (a: Set<string>, b: Set<string>) => [...a].every((x) => !b.has(x));

test("a cultural-only interview never opens on an angle from the résumé pool", () => {
  const resume = openers({ sources: ["resume"] });
  const cultural = openers({ sources: ["cultural"] });

  expect(cultural.size).toBeGreaterThan(1);
  expect(disjoint(cultural, resume)).toBe(true);
  // Nothing in a people interview may reach for the document it doesn't read.
  for (const angle of cultural) expect(angle).not.toMatch(/résumé/);
});

test("a résumé + cultural blend draws openers from both pools", () => {
  const resume = openers({ sources: ["resume"] });
  const cultural = openers({ sources: ["cultural"] });
  const blend = openers({ sources: ["resume", "cultural"] });

  // Reaching *both* pools means reaching past either one on its own — asserting
  // only "some came from résumé, some from cultural" would hold trivially if the
  // two pools were the same array, which is precisely the bug.
  expect([...blend].some((a) => resume.has(a) && !cultural.has(a))).toBe(true);
  expect([...blend].some((a) => cultural.has(a) && !resume.has(a))).toBe(true);
  // ...and nowhere else: the union of its own sources is the whole allowance.
  expect([...blend].every((a) => resume.has(a) || cultural.has(a))).toBe(true);
  expect(blend.size).toBe(resume.size + cultural.size);
});

test("the interviewer is only stripped of 'technical' when the interview is cultural-only", () => {
  expect(questionSystem(ctx({ sources: ["cultural"] }).config)).not.toContain("technical interviewer");
  expect(questionSystem(ctx({ mode: "cultural_only" }).config)).not.toContain("technical interviewer");
  expect(questionSystem(ctx({ sources: ["resume"] }).config)).toContain("technical interviewer");
  expect(questionSystem(ctx({ sources: ["cultural", "resume"] }).config)).toContain(
    "technical interviewer",
  );
  expect(questionSystem(ctx({ mode: "real" }).config)).toContain("technical interviewer");
});

test("a cultural-only interview never receives the résumé text", () => {
  const fingerprint = "Staff engineer. Shipped a billing ledger on Postgres.";
  for (const config of [{ sources: ["cultural"] as const }, { mode: "cultural_only" as const }]) {
    const first = firstQuestionPrompt(ctx(config));
    const next = followUpPrompt(ctx(config), [{ question: "Q", answer: "A" }], 3);
    expect(first).not.toContain(fingerprint);
    expect(next).not.toContain(fingerprint);
    expect(first).toContain("No résumé is provided");
    expect(first).toContain("culture-fit");
    expect(culturalOnly(ctx(config).config)).toBe(true);
  }

  // A résumé interview still gets the document — the omission is deliberate, not a bug.
  expect(firstQuestionPrompt(ctx({ sources: ["resume"] }))).toContain(fingerprint);
});

test("a cultural-only follow-up is told to follow the person, not the technology", () => {
  const cultural = followUpPrompt(
    ctx({ sources: ["cultural"] }),
    [{ question: "Tell me about a call you got wrong", answer: "The ledger drifted so I re-ran the job" }],
    3,
  );
  expect(cultural).toContain("do not follow the\ntechnology — follow the person in it");
  expect(cultural).toContain("Never ask how a system works");

  expect(followUpPrompt(ctx({ mode: "cultural_only" }), [{ question: "Q", answer: "A" }], 3)).toContain(
    "follow the person in it",
  );

  expect(followUpPrompt(ctx({ sources: ["resume"] }), [{ question: "Q", answer: "A" }], 3)).not.toContain(
    "follow the person in it",
  );
});

test("a pure subject drill never leans toward the résumé or how they work with people", () => {
  const resumeAreas = nextAreas({ sources: ["resume"] });
  const topicAreas = nextAreas({ mode: "topic_only", topic: "Postgres indexing" });

  // The people angle is the tell: it lives in the technical pool, and a pure
  // subject drill is defined by ignoring both it and the résumé.
  expect(resumeAreas).toContain("how they work with other people");
  expect(topicAreas.size).toBeGreaterThan(1);
  expect(topicAreas).not.toContain("how they work with other people");
  for (const area of topicAreas) expect(area).not.toMatch(/résumé/);
});

test("a real interview is steered by its stage brief alone, and still reaches its close", () => {
  const total = 8;
  const c = ctx({ mode: "real", num_questions: total });
  const history = Array.from({ length: total - 1 }, (_, i) => ({
    question: `Q${i + 1}`,
    answer: `A${i + 1}`,
  }));

  expect(stageFor(total - 1, total)).toBe("closing");
  const last = followUpPrompt(c, history, 0);
  // A random angle here would outrank the brief and cost the interview its ending.
  expect(last).not.toContain("lean toward:");
  expect(last).toContain("that the stage brief above calls for.");
  expect(last).toContain("Do you have any questions for us?");

  // Every earlier question too — the angle is suppressed for the whole mode.
  for (let i = 1; i < total - 1; i++) {
    expect(followUpPrompt(c, history.slice(0, i), total - 1 - i)).not.toContain("lean toward:");
  }

  expect(firstQuestionPrompt(c)).not.toContain("Open on:");
  expect(firstQuestionPrompt(c)).toContain("Stage: INTRO (question 1 of 8).");
});

test("weak_spots with no scored history does not point at questions that aren't there", () => {
  const c = ctx({ mode: "weak_spots" });

  const empty = firstQuestionPrompt(c, {});
  expect(empty).not.toContain("questions below");
  expect(empty).not.toContain("retry session");
  expect(empty).toContain("Interview them on their own history");
  expect(followUpPrompt(c, [{ question: "Q", answer: "A" }], 3, {})).not.toContain("questions below");

  // With history the brief means what it says, and the list is really there.
  const withWeak = firstQuestionPrompt(c, {
    weakSpots: [{ question: "How did you shard the ledger?", transcript: "um, I don't recall" }],
  });
  expect(withWeak).toContain("questions below");
  expect(withWeak).toContain("How did you shard the ledger?");
});
