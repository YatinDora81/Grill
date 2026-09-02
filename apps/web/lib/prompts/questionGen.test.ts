import { test, expect } from "bun:test";
import type { InterviewConfig, Persona } from "@repo/types";
import { PERSONAS, PERSONA_GUARDRAIL, PERSONA_META, drillTurnBudget } from "@/lib/interviewMeta";
import { EVALUATION_SYSTEM, evaluationPrompt } from "./evaluation";
import {
  culturalOnly,
  firstQuestionPrompt,
  followUpPrompt,
  questionSystem,
  stageFor,
} from "./questionGen";
import type { SessionContext } from "./questionGen";

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
  sample(() => followUpPrompt(ctx(c), [{ question: "Q1", answer: "A1" }], 3), LEAN_TOWARD);

const disjoint = (a: Set<string>, b: Set<string>) => [...a].every((x) => !b.has(x));

test("a cultural-only interview never opens on an angle from the résumé pool", () => {
  const resume = openers({ sources: ["resume"] });
  const cultural = openers({ sources: ["cultural"] });

  expect(cultural.size).toBeGreaterThan(1);
  expect(disjoint(cultural, resume)).toBe(true);
  for (const angle of cultural) expect(angle).not.toMatch(/résumé/);
});

test("a résumé + cultural blend draws openers from both pools", () => {
  const resume = openers({ sources: ["resume"] });
  const cultural = openers({ sources: ["cultural"] });
  const blend = openers({ sources: ["resume", "cultural"] });

  expect([...blend].some((a) => resume.has(a) && !cultural.has(a))).toBe(true);
  expect([...blend].some((a) => cultural.has(a) && !resume.has(a))).toBe(true);
  expect([...blend].every((a) => resume.has(a) || cultural.has(a))).toBe(true);
  expect(blend.size).toBe(resume.size + cultural.size);
});

test("the interviewer is only stripped of 'technical' when the interview is cultural-only", () => {
  expect(questionSystem(ctx({ sources: ["cultural"] }).config)).not.toContain(
    "technical interviewer",
  );
  expect(questionSystem(ctx({ mode: "cultural_only" }).config)).not.toContain(
    "technical interviewer",
  );
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

  expect(firstQuestionPrompt(ctx({ sources: ["resume"] }))).toContain(fingerprint);
});

test("a cultural-only follow-up is told to follow the person, not the technology", () => {
  const cultural = followUpPrompt(
    ctx({ sources: ["cultural"] }),
    [
      {
        question: "Tell me about a call you got wrong",
        answer: "The ledger drifted so I re-ran the job",
      },
    ],
    3,
  );
  expect(cultural).toContain("do not follow the\ntechnology — follow the person in it");
  expect(cultural).toContain("Never ask how a system works");

  expect(
    followUpPrompt(ctx({ mode: "cultural_only" }), [{ question: "Q", answer: "A" }], 3),
  ).toContain("follow the person in it");

  expect(
    followUpPrompt(ctx({ sources: ["resume"] }), [{ question: "Q", answer: "A" }], 3),
  ).not.toContain("follow the person in it");
});

test("a pure subject drill never leans toward the résumé or how they work with people", () => {
  const resumeAreas = nextAreas({ sources: ["resume"] });
  const topicAreas = nextAreas({ mode: "topic_only", topic: "Postgres indexing" });

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
  expect(last).not.toContain("lean toward:");
  expect(last).toContain("that the stage brief above calls for.");
  expect(last).toContain("Do you have any questions for us?");

  for (let i = 1; i < total - 1; i++) {
    expect(followUpPrompt(c, history.slice(0, i), total - 1 - i)).not.toContain("lean toward:");
  }

  expect(firstQuestionPrompt(c)).not.toContain("Open on:");
  expect(firstQuestionPrompt(c)).toContain("Stage: INTRO (question 1 of 8).");
});

test("a project interview is briefed on the project and carries its material", () => {
  const project =
    "A distributed rate limiter on Redis sorted sets, with a lease-based leader election.";
  const c = ctx({
    mode: "project",
    project_context: project,
    project_repo_url: "https://github.com/YatinDora81/Grill",
  });

  const first = firstQuestionPrompt(c);
  expect(first).toContain("Interview them on THE PROJECT");
  expect(first).toContain(project);
  expect(first).toContain("Project repository: https://github.com/YatinDora81/Grill");
  expect(openers({ mode: "project", project_context: project }).size).toBeGreaterThan(1);
  expect(nextAreas({ mode: "project", project_context: project }).size).toBeGreaterThan(1);
});

test("a project interview shows the résumé only when one was actually provided", () => {
  const project = "A URL shortener: Postgres, base62 IDs, a Redis read-through cache.";
  const fingerprint = "Staff engineer. Shipped a billing ledger on Postgres.";

  const withResume = firstQuestionPrompt(ctx({ mode: "project", project_context: project }));
  expect(withResume).toContain(fingerprint);
  expect(withResume).toContain("Their résumé, background only");

  const noResume = firstQuestionPrompt({
    ...ctx({ mode: "project", project_context: project }),
    sourceText: "",
  });
  expect(noResume).toContain(project);
  expect(noResume).not.toContain(fingerprint);
  expect(noResume).not.toContain("Their résumé, background only");
});

test("weak_spots with no scored history does not point at questions that aren't there", () => {
  const c = ctx({ mode: "weak_spots" });

  const empty = firstQuestionPrompt(c, {});
  expect(empty).not.toContain("questions below");
  expect(empty).not.toContain("retry session");
  expect(empty).toContain("Interview them on their own history");
  expect(followUpPrompt(c, [{ question: "Q", answer: "A" }], 3, {})).not.toContain(
    "questions below",
  );

  const withWeak = firstQuestionPrompt(c, {
    weakSpots: [{ question: "How did you shard the ledger?", transcript: "um, I don't recall" }],
  });
  expect(withWeak).toContain("questions below");
  expect(withWeak).toContain("How did you shard the ledger?");
});

const NON_NEUTRAL: readonly Persona[] = PERSONAS.filter((p) => p !== "neutral");

test("a persona is appended to the interviewer's voice, and neutral appends nothing", () => {
  const neutral = questionSystem(ctx({ sources: ["resume"] }).config);
  expect(questionSystem(ctx({ sources: ["resume"], persona: "neutral" }).config)).toBe(neutral);
  expect(neutral).not.toContain("Voice:");
  expect(neutral).not.toContain(PERSONA_GUARDRAIL);

  expect(NON_NEUTRAL.length).toBe(4);
  for (const p of NON_NEUTRAL) {
    for (const shape of [{ sources: ["resume"] as const }, { mode: "cultural_only" as const }]) {
      const system = questionSystem(ctx({ ...shape, persona: p }).config);
      expect(system).toContain(PERSONA_META[p].prompt);
      expect(system).toContain(PERSONA_GUARDRAIL);
      expect(system.trimEnd().endsWith("Respond with JSON only — no prose, no code fences.")).toBe(
        true,
      );
    }
  }
});

test("scoring is persona-blind: the evaluation prompt is byte-identical across every persona", () => {
  const q = "Why that shard key?";
  const a = "Tenant id — it was the only even split we had.";
  const baseline = evaluationPrompt(q, "technical", a);

  for (const p of PERSONAS) {
    const config = ctx({ sources: ["resume"], persona: p }).config;
    expect(evaluationPrompt(q, "technical", a)).toBe(baseline);
    expect(evaluationPrompt(q, "cultural", a)).toBe(evaluationPrompt(q, "cultural", a));
    if (p !== "neutral") expect(questionSystem(config)).toContain(PERSONA_META[p].prompt);
  }

  expect(EVALUATION_SYSTEM).not.toContain("Voice:");
  expect(EVALUATION_SYSTEM).not.toContain(PERSONA_GUARDRAIL);
  for (const p of NON_NEUTRAL) {
    expect(baseline).not.toContain(PERSONA_META[p].prompt);
    expect(EVALUATION_SYSTEM).not.toContain(PERSONA_META[p].label);
  }
});

test("a starred drill fixes its primaries, in order, exempt from the do-not-repeat ban", () => {
  const fixed = [
    "You said “we” — what did you own?",
    "What happens to your cache design at ten times the load?",
    "Defend the decision you'd undo.",
  ];
  const c = ctx({ mode: "starred", num_questions: fixed.length });

  const first = firstQuestionPrompt(c, {
    fixedQuestions: fixed,
    askedBefore: ["Tell me about the migration you skipped."],
  });
  expect(first).toContain("The primaries for this interview are fixed, in this order");
  fixed.forEach((q, i) => expect(first).toContain(`${i + 1}. ${q}`));
  expect(first).toContain("Ask fixed primary 1 above, word for word.");
  expect(first).not.toContain("Open on:");

  const banned = first.slice(first.indexOf("Do NOT ask any of them again"));
  expect(banned).toContain("Tell me about the migration you skipped.");
  for (const q of fixed) expect(banned).not.toContain(q);
});

test("an asked fixed primary drops off the list and the rest keep their order", () => {
  const fixed = ["Q one?", "Q two?", "Q three?"];
  const c = ctx({ mode: "starred", num_questions: fixed.length });

  const next = followUpPrompt(c, [{ question: "Q one?", answer: "I owned the schema." }], 1, {
    fixedQuestions: fixed,
  });
  expect(next).toContain("1. Q two?");
  expect(next).toContain("2. Q three?");
  expect(next).not.toContain("1. Q one?");
  expect(next).not.toContain("lean toward:");
});

test("a fixed primary only yields its turn when there is a spare question to spend", () => {
  const fixed = ["Q one?", "Q two?"];
  const c = ctx({ mode: "starred" });
  const history = [{ question: "Q one?", answer: "…" }];

  expect(followUpPrompt(c, history, 0, { fixedQuestions: fixed })).toContain(
    "Every question left is spoken for",
  );
  expect(followUpPrompt(c, history, 3, { fixedQuestions: fixed })).toContain(
    "you may spend this turn on ONE targeted follow-up",
  );

  const done = followUpPrompt(
    c,
    fixed.map((q) => ({ question: q, answer: "…" })),
    2,
    { fixedQuestions: fixed },
  );
  expect(done).not.toContain("The primaries for this interview are fixed");
  expect(done).toContain("lean toward:");
});

test("the drill's real turn budget reaches the follow-up branch at every primary", () => {
  const fixed = ["Q one?", "Q two?", "Q three?"];
  const total = drillTurnBudget(fixed.length);
  const c = ctx({ mode: "starred", num_questions: total });

  for (let answered = 1; answered < fixed.length; answered++) {
    const history = fixed.slice(0, answered).map((q) => ({ question: q, answer: "…" }));
    const nextIndex = history.length;
    const turnsRemaining = total - (nextIndex + 1);
    expect(followUpPrompt(c, history, turnsRemaining, { fixedQuestions: fixed })).toContain(
      "you may spend this turn on ONE targeted follow-up",
    );
  }

  const starved = fixed.length;
  const opened = [{ question: "Q one?", answer: "…" }];
  expect(followUpPrompt(c, opened, starved - 2, { fixedQuestions: fixed })).toContain(
    "Every question left is spoken for",
  );
});

test("no other interview shape sees a fixed list or a persona paragraph", () => {
  for (const config of [
    { sources: ["resume"] as const },
    { mode: "real" as const },
    { mode: "weak_spots" as const },
    { mode: "cultural_only" as const },
  ]) {
    const first = firstQuestionPrompt(ctx(config), { askedBefore: ["Old question?"] });
    const next = followUpPrompt(ctx(config), [{ question: "Q", answer: "A" }], 3, {});
    expect(first).not.toContain("The primaries for this interview are fixed");
    expect(next).not.toContain("The primaries for this interview are fixed");
    expect(questionSystem(ctx(config).config)).not.toContain("Voice:");
  }
});

const JD = {
  mode: "jd" as const,
  job_description: "Own the payments ledger. Ship weekly.",
  company: "Stripe",
  job_title: "Staff Engineer",
  job_location: "Remote (EU)",
};

const BRIEF = {
  values: ["Users first", "Move with urgency"],
  style_notes: ["A long systems-design round", "They ask for numbers"],
};

test("a JD interview's company brief reaches the prompt as values and style notes", () => {
  for (const prompt of [
    firstQuestionPrompt(ctx(JD), { companyBrief: BRIEF }),
    followUpPrompt(ctx(JD), [{ question: "Q1", answer: "A1" }], 3, { companyBrief: BRIEF }),
  ]) {
    expect(prompt).toContain("This posting is at Stripe — Staff Engineer, Remote (EU).");
    expect(prompt).toContain("Their stated values: Users first; Move with urgency.");
    expect(prompt).toContain(
      "Their interviews are known for: A long systems-design round; They ask for numbers.",
    );
    expect(prompt).toContain(
      "Let this shape WHAT you probe, not how hard you probe — the difficulty and the rubric do not move.",
    );
    expect(prompt.indexOf("This posting is at Stripe")).toBeLessThan(
      prompt.indexOf("The job description they are targeting:"),
    );
  }
});

test("a posting with nobody researched yet still names the company, and nothing more", () => {
  const prompt = firstQuestionPrompt(ctx(JD));
  expect(prompt).toContain("This posting is at Stripe — Staff Engineer, Remote (EU).");
  expect(prompt).not.toContain("Their stated values:");
  expect(prompt).not.toContain("Their interviews are known for:");
  expect(prompt).not.toContain("Let this shape WHAT you probe");
});

test("a brief whose lists came back blank is the same as no brief at all", () => {
  const prompt = firstQuestionPrompt(ctx(JD), {
    companyBrief: { values: ["  ", ""], style_notes: [] },
  });
  expect(prompt).not.toContain("Their stated values:");
  expect(prompt).not.toContain("Their interviews are known for:");
  expect(prompt).not.toContain("Let this shape WHAT you probe");
});

test("a hand-pasted posting that named nobody carries no company block", () => {
  const prompt = firstQuestionPrompt(
    ctx({ mode: "jd", job_description: "Own the payments ledger." }),
    { companyBrief: BRIEF },
  );
  expect(prompt).toContain("The job description they are targeting:");
  expect(prompt).not.toContain("This posting is at");
  expect(prompt).not.toContain("Their stated values:");
});

test("no interview without a posting reaches a company brief, however it was handed one", () => {
  for (const config of [
    { sources: ["resume"] as const, company: "Stripe" },
    { mode: "real" as const, company: "Stripe" },
    { mode: "topic_only" as const, company: "Stripe" },
    { mode: "cultural_only" as const, company: "Stripe" },
  ]) {
    const first = firstQuestionPrompt(ctx(config), { companyBrief: BRIEF });
    const next = followUpPrompt(ctx(config), [{ question: "Q", answer: "A" }], 3, {
      companyBrief: BRIEF,
    });
    for (const prompt of [first, next]) {
      expect(prompt).not.toContain("This posting is at");
      expect(prompt).not.toContain("Their stated values:");
      expect(prompt).not.toContain("Their interviews are known for:");
    }
  }
});

test("a cut-off answer tells the next question to make them land the point", () => {
  const c = ctx({ sources: ["resume"], persona: "terse_staff" });
  const history = [{ question: "Q one?", answer: "A long one." }];

  const cut = followUpPrompt(c, history, 3, { lastAnswerInterruptedAtS: 76 });
  expect(cut).toContain("The interviewer cut the candidate off at 76s because the answer ran");
  expect(cut).toContain("land the point in one or two sentences");

  expect(followUpPrompt(c, history, 3, {})).not.toContain("cut the candidate off");
});
