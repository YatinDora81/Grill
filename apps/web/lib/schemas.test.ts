import { describe, expect, mock, test } from "bun:test";
import type {
  CameraTurnMetrics,
  CompanyBrief,
  DeliveryMetrics,
  StarBreakdown,
} from "@repo/types";

mock.module("server-only", () => ({}));

process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

const { DIFFICULTIES, PERSONAS, QUESTION_BOUNDS } = await import("./interviewMeta");
const {
  COMPANY_MAX_CHARS,
  GAP_JD_MAX_CHARS,
  GAP_RESUME_MAX_CHARS,
  JOB_PAGE_TEXT_MAX_CHARS,
  answerTextSchema,
  cameraMetricsSchema,
  companyBriefRequestSchema,
  companyBriefSchema,
  deliveryMetricsSchema,
  drillReviewSchema,
  drillTextAnswerSchema,
  interviewConfigSchema,
  jdExtractRequestSchema,
  jobExtractSchema,
  questionResponseSchema,
  resumeGapRequestSchema,
  resumeGapResponseSchema,
  starBreakdownSchema,
  starResponseSchema,
  startRequestSchema,
  storedConfigSchema,
  turnRefSchema,
  updateProfileSchema,
  voiceRequestSchema,
} = await import("./schemas");

function cfg(over: Record<string, unknown> = {}) {
  return { sources: ["resume"], mode: null, ...over };
}

function start(over: Record<string, unknown> = {}) {
  return { source_text: "Staff engineer. Shipped a billing ledger.", name: "Backend screen", config: cfg(), ...over };
}

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error!.issues.map((i) => i.path.join("."));
}

describe("the mode XOR sources invariant", () => {
  test("rejects an exclusive mode carrying sources as well", () => {
    const r = interviewConfigSchema.safeParse(cfg({ mode: "jd", job_description: "Senior Go role", sources: ["resume"] }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("sources");
  });

  test("rejects a config that draws on neither a mode nor any source", () => {
    const r = interviewConfigSchema.safeParse(cfg({ mode: null, sources: [] }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("sources");
  });

  test("accepts an exclusive mode with an empty source list", () => {
    const r = interviewConfigSchema.safeParse(cfg({ mode: "real", sources: [] }));
    expect(r.success).toBe(true);
    expect(r.data!.mode).toBe("real");
    expect(r.data!.sources).toEqual([]);
  });

  test("accepts cultural_only as an exclusive mode with no extra material", () => {
    const r = interviewConfigSchema.safeParse(cfg({ mode: "cultural_only", sources: [] }));
    expect(r.success).toBe(true);
    expect(r.data!.mode).toBe("cultural_only");
  });

  test("accepts blended sources with a null mode", () => {
    const r = interviewConfigSchema.safeParse(cfg({ mode: null, sources: ["resume", "topic", "cultural"], topic: "Kafka" }));
    expect(r.success).toBe(true);
    expect(r.data!.sources).toEqual(["resume", "topic", "cultural"]);
    expect(r.data!.mode).toBeNull();
  });
});

describe("material a mode or source cannot run without", () => {
  test("requires a topic when the topic source is picked", () => {
    const r = interviewConfigSchema.safeParse(cfg({ sources: ["resume", "topic"] }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("topic");
  });

  test("requires a topic for a topic_only interview, which has nothing else to ask about", () => {
    const r = interviewConfigSchema.safeParse(cfg({ mode: "topic_only", sources: [] }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("topic");
  });

  test("does not accept whitespace as a topic", () => {
    const r = interviewConfigSchema.safeParse(cfg({ mode: "topic_only", sources: [], topic: "   " }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("topic");
  });

  test("requires a job description for a jd interview", () => {
    const r = interviewConfigSchema.safeParse(cfg({ mode: "jd", sources: [] }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("job_description");
  });

  test("requires project context for a project interview, which has nothing else to ask about", () => {
    const r = interviewConfigSchema.safeParse(cfg({ mode: "project", sources: [] }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("project_context");
  });

  test("does not accept whitespace as project context", () => {
    const r = interviewConfigSchema.safeParse(
      cfg({ mode: "project", sources: [], project_context: "   " }),
    );
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("project_context");
  });

  test("accepts a project interview once it carries its material", () => {
    const r = interviewConfigSchema.safeParse(
      cfg({ mode: "project", sources: [], project_context: "A rate limiter built on Redis sorted sets." }),
    );
    expect(r.success).toBe(true);
    expect(r.data!.mode).toBe("project");
  });

  test("asks for no topic when neither the source nor the mode wants one", () => {
    expect(interviewConfigSchema.safeParse(cfg({ sources: ["resume", "cultural"] })).success).toBe(true);
  });
});

describe("bounds", () => {
  test("pins the bounds the form, the API and the prompt all quote", () => {
    expect(QUESTION_BOUNDS).toEqual({ min: 3, max: 100 });
    expect([...DIFFICULTIES]).toEqual(["easy", "medium", "hard", "extreme"]);
  });

  test("accepts a new interview at both question bounds", () => {
    expect(startRequestSchema.safeParse(start({ config: cfg({ num_questions: QUESTION_BOUNDS.min }) })).success).toBe(true);
    expect(startRequestSchema.safeParse(start({ config: cfg({ num_questions: QUESTION_BOUNDS.max }) })).success).toBe(true);
  });

  test("rejects a new interview one question either side of the bounds", () => {
    const under = startRequestSchema.safeParse(start({ config: cfg({ num_questions: QUESTION_BOUNDS.min - 1 }) }));
    expect(under.success).toBe(false);
    expect(issuePaths(under)).toContain("config.num_questions");

    const over = startRequestSchema.safeParse(start({ config: cfg({ num_questions: QUESTION_BOUNDS.max + 1 }) }));
    expect(over.success).toBe(false);
    expect(issuePaths(over)).toContain("config.num_questions");
  });

  test("still reads a stored session recorded under the old 1-question floor", () => {
    const r = storedConfigSchema.safeParse({ ...cfg(), num_questions: 2 });
    expect(r.success).toBe(true);
    expect(r.data!.num_questions).toBe(2);
  });

  test("rejects a stored config with fewer than one question", () => {
    expect(storedConfigSchema.safeParse({ ...cfg(), num_questions: 0 }).success).toBe(false);
  });

  test("accepts every difficulty mode and rejects an invented one", () => {
    for (const d of DIFFICULTIES) {
      expect(interviewConfigSchema.safeParse(cfg({ difficulty: d })).success).toBe(true);
    }
    expect(interviewConfigSchema.safeParse(cfg({ difficulty: "nightmare" })).success).toBe(false);
  });

  test("rejects a fractional question count", () => {
    expect(interviewConfigSchema.safeParse(cfg({ num_questions: 7.5 })).success).toBe(false);
  });

  test("caps the résumé at 20k characters, one character past being the failure", () => {
    expect(startRequestSchema.safeParse(start({ source_text: "a".repeat(20_000) })).success).toBe(true);

    const over = startRequestSchema.safeParse(start({ source_text: "a".repeat(20_001) }));
    expect(over.success).toBe(false);
    expect(issuePaths(over)).toContain("source_text");
  });

  test("rejects an empty résumé and an unnamed interview", () => {
    expect(startRequestSchema.safeParse(start({ source_text: "" })).success).toBe(false);
    expect(startRequestSchema.safeParse(start({ name: "   " })).success).toBe(false);
  });
});

describe("the résumé is optional only for a project interview", () => {
  function projectCfg(over: Record<string, unknown> = {}) {
    return cfg({
      mode: "project",
      sources: [],
      project_context: "A URL shortener: Postgres, a base62 encoder, and a Redis read-through cache.",
      ...over,
    });
  }

  test("accepts a project interview with no résumé at all", () => {
    const r = startRequestSchema.safeParse(start({ source_text: "", config: projectCfg() }));
    expect(r.success).toBe(true);
    expect(r.data!.source_text).toBe("");
  });

  test("still requires the résumé for every non-project mode", () => {
    const r = startRequestSchema.safeParse(start({ source_text: "", config: cfg({ mode: "real", sources: [] }) }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("source_text");
  });

  test("takes a résumé alongside the project when one is offered as background", () => {
    const r = startRequestSchema.safeParse(
      start({ source_text: "Staff engineer, 8 years.", config: projectCfg() }),
    );
    expect(r.success).toBe(true);
  });

  test("carries the repo URL through, and rejects a non-URL", () => {
    const ok = startRequestSchema.safeParse(
      start({ source_text: "", config: projectCfg({ project_repo_url: "https://github.com/YatinDora81/Grill" }) }),
    );
    expect(ok.success).toBe(true);
    expect(ok.data!.config.project_repo_url).toBe("https://github.com/YatinDora81/Grill");

    const bad = startRequestSchema.safeParse(
      start({ source_text: "", config: projectCfg({ project_repo_url: "not-a-url" }) }),
    );
    expect(bad.success).toBe(false);
  });
});

describe("defaults", () => {
  test("leaves repeats off unless they are asked for", () => {
    expect(interviewConfigSchema.safeParse(cfg()).data!.allow_repeats).toBe(false);
    expect(interviewConfigSchema.safeParse(cfg({ allow_repeats: true })).data!.allow_repeats).toBe(true);
  });

  test("pitches a config with no stated difficulty at medium, not at easy", () => {
    expect(interviewConfigSchema.safeParse(cfg()).data!.difficulty).toBe("medium");
    expect(storedConfigSchema.safeParse(cfg()).data!.difficulty).toBe("medium");
  });

  test("carries a stored per-answer cap through, and treats its absence as 'use the default'", () => {
    expect(storedConfigSchema.safeParse({ ...cfg(), max_answer_seconds: 180 }).data!.max_answer_seconds).toBe(180);
    expect(storedConfigSchema.safeParse(cfg()).data!.max_answer_seconds).toBeUndefined();
  });
});

describe("configs written under older shapes", () => {
  test("maps the legacy resume mode onto the resume source", () => {
    const r = storedConfigSchema.safeParse({ mode: "resume", num_questions: 8 });
    expect(r.success).toBe(true);
    expect(r.data!.sources).toEqual(["resume"]);
    expect(r.data!.mode).toBeNull();
  });

  test("maps the legacy topic mode onto resume + topic, since it always carried the résumé", () => {
    const r = storedConfigSchema.safeParse({ mode: "topic", topic: "Kafka" });
    expect(r.success).toBe(true);
    expect(r.data!.sources).toEqual(["resume", "topic"]);
    expect(r.data!.mode).toBeNull();
  });

  test("leaves an exclusive mode's sources empty rather than assuming a résumé", () => {
    const r = storedConfigSchema.safeParse({ mode: "weak_spots" });
    expect(r.success).toBe(true);
    expect(r.data!.mode).toBe("weak_spots");
    expect(r.data!.sources).toEqual([]);
  });

  test("assumes the résumé for a row that names neither a mode nor sources", () => {
    const r = storedConfigSchema.safeParse({ num_questions: 8 });
    expect(r.success).toBe(true);
    expect(r.data!.sources).toEqual(["resume"]);
  });

  test.each([
    ["junior", "easy"],
    ["mid", "medium"],
    ["senior", "hard"],
  ])("reads the legacy %s bucket as %s", (legacy, difficulty) => {
    const r = storedConfigSchema.safeParse({ ...cfg(), difficulty: legacy });
    expect(r.success).toBe(true);
    expect(r.data!.difficulty).toBe(difficulty);
  });

  test.each([
    [1, "easy"],
    [2, "easy"],
    [3, "medium"],
    [6, "medium"],
    [7, "hard"],
    [12, "hard"],
    [13, "extreme"],
    [20, "extreme"],
  ])("maps stored years_experience %i to %s", (years, difficulty) => {
    const r = storedConfigSchema.safeParse({ ...cfg(), years_experience: years });
    expect(r.success).toBe(true);
    expect(r.data!.difficulty).toBe(difficulty);
    expect(r.data!).not.toHaveProperty("years_experience");
  });

  test("falls back to medium rather than failing on an unrecognised difficulty", () => {
    expect(storedConfigSchema.safeParse({ ...cfg(), difficulty: "staff" }).data!.difficulty).toBe("medium");
  });

  test("lets an explicit year count win over a legacy difficulty left on the row", () => {
    const r = storedConfigSchema.safeParse({ ...cfg(), difficulty: "junior", years_experience: 15 });
    expect(r.data!.difficulty).toBe("extreme");
  });

  test.each(["cultural", "behavioral"])(
    "folds the legacy %s focus into the cultural source",
    (interview_type) => {
      const r = storedConfigSchema.safeParse({ sources: ["resume"], mode: null, interview_type });
      expect(r.success).toBe(true);
      expect(r.data!.sources).toEqual(["resume", "cultural"]);
    },
  );

  test("does not fold the legacy focus into an exclusive mode, which would break the XOR", () => {
    const r = storedConfigSchema.safeParse({ mode: "jd", job_description: "Senior Go role", interview_type: "cultural" });
    expect(r.success).toBe(true);
    expect(r.data!.sources).toEqual([]);
  });

  test("does not duplicate the cultural source when the row already names it", () => {
    const r = storedConfigSchema.safeParse({ sources: ["resume", "cultural"], mode: null, interview_type: "cultural" });
    expect(r.data!.sources).toEqual(["resume", "cultural"]);
  });

  test("drops a legacy technical focus without touching the sources", () => {
    const r = storedConfigSchema.safeParse({ sources: ["resume"], mode: null, interview_type: "technical" });
    expect(r.success).toBe(true);
    expect(r.data!.sources).toEqual(["resume"]);
  });

  test("migrates a row carrying every legacy field at once", () => {
    const r = storedConfigSchema.safeParse({
      mode: "topic",
      topic: "Kafka",
      difficulty: "senior",
      interview_type: "behavioral",
      num_questions: "5",
    });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      num_questions: 5,
      difficulty: "hard",
      sources: ["resume", "topic", "cultural"],
      mode: null,
      topic: "Kafka",
    });
  });

  test("leaves a row written before personas and starred drills otherwise untouched", () => {
    const r = storedConfigSchema.safeParse({
      mode: "topic",
      topic: "Kafka",
      difficulty: "senior",
      num_questions: "5",
    });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      num_questions: 5,
      difficulty: "hard",
      persona: "neutral",
      sources: ["resume", "topic"],
      mode: null,
      topic: "Kafka",
    });
    expect(r.data!.starred_hashes).toBeUndefined();
  });

  test("still rejects a stored row that migration cannot rescue", () => {
    expect(storedConfigSchema.safeParse({ sources: ["astrology"], mode: null }).success).toBe(false);
    expect(storedConfigSchema.safeParse("not a config").success).toBe(false);
    expect(storedConfigSchema.safeParse(null).success).toBe(false);
  });
});

describe("the interviewer's persona", () => {
  test("reads a config that never named one as neutral", () => {
    expect(interviewConfigSchema.safeParse(cfg()).data!.persona).toBe("neutral");
    expect(storedConfigSchema.safeParse(cfg()).data!.persona).toBe("neutral");
    expect(
      storedConfigSchema.safeParse({ mode: "topic", topic: "Kafka", difficulty: "senior" }).data!
        .persona,
    ).toBe("neutral");
  });

  test("round-trips every persona the picker offers", () => {
    for (const persona of PERSONAS) {
      expect(interviewConfigSchema.safeParse(cfg({ persona })).data!.persona).toBe(persona);
      expect(storedConfigSchema.safeParse(cfg({ persona })).data!.persona).toBe(persona);
    }
  });

  test("rejects a persona nobody wrote", () => {
    expect(interviewConfigSchema.safeParse(cfg({ persona: "drill_sergeant" })).success).toBe(false);
    expect(interviewConfigSchema.safeParse(cfg({ persona: null })).success).toBe(false);
  });
});

describe("the starred drill", () => {
  const HASH_A = "a".repeat(64);
  const HASH_B = "b1".repeat(32);

  function starred(over: Record<string, unknown> = {}) {
    return cfg({ mode: "starred", sources: [], starred_hashes: [HASH_A], ...over });
  }

  test("keeps the hashes in the order they were picked, since that is the ask order", () => {
    const r = interviewConfigSchema.safeParse(starred({ starred_hashes: [HASH_B, HASH_A] }));
    expect(r.success).toBe(true);
    expect(r.data!.starred_hashes).toEqual([HASH_B, HASH_A]);
  });

  test("rejects a starred drill with nothing to drill", () => {
    const r = interviewConfigSchema.safeParse(cfg({ mode: "starred", sources: [] }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("starred_hashes");
  });

  test("rejects an empty selection, which is the same interview about nothing", () => {
    const r = interviewConfigSchema.safeParse(starred({ starred_hashes: [] }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("starred_hashes");
  });

  test.each(["weak_spots", "real", "cultural_only"])(
    "rejects saved questions carried by a %s interview",
    (mode) => {
      const r = interviewConfigSchema.safeParse(
        cfg({ mode, sources: [], starred_hashes: [HASH_A] }),
      );
      expect(r.success).toBe(false);
      expect(issuePaths(r)).toContain("starred_hashes");
    },
  );

  test("rejects saved questions carried by a blended sources interview", () => {
    const r = interviewConfigSchema.safeParse(
      cfg({ mode: null, sources: ["resume"], starred_hashes: [HASH_A] }),
    );
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("starred_hashes");
  });

  test.each([["A".repeat(64)], ["a".repeat(63)], ["z".repeat(64)], [""]])(
    "rejects %s, which is not a question hash the repo ever produced",
    (hash) => {
      expect(interviewConfigSchema.safeParse(starred({ starred_hashes: [hash] })).success).toBe(
        false,
      );
    },
  );

  test("drills at most twelve saved questions in one sitting", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(64, "0"));
    expect(interviewConfigSchema.safeParse(starred({ starred_hashes: twelve })).success).toBe(true);

    const thirteen = Array.from({ length: 13 }, (_, i) => i.toString(16).padStart(64, "0"));
    const over = interviewConfigSchema.safeParse(starred({ starred_hashes: thirteen }));
    expect(over.success).toBe(false);
    expect(issuePaths(over)).toContain("starred_hashes");
  });

  test("leaves the question count alone — matching it to the selection is service work", () => {
    const r = interviewConfigSchema.safeParse(
      starred({ starred_hashes: [HASH_A, HASH_B], num_questions: 8 }),
    );
    expect(r.success).toBe(true);
    expect(r.data!.num_questions).toBe(8);
  });

  test.each([1, 2])(
    "starts a drill of %i saved question(s), a size the whole-interview floor has no say over",
    (n) => {
      const hashes = Array.from({ length: n }, (_, i) => i.toString(16).padStart(64, "0"));
      const r = startRequestSchema.safeParse(
        start({ config: starred({ starred_hashes: hashes, num_questions: n }) }),
      );
      expect(r.success).toBe(true);
      expect(r.data!.config.starred_hashes).toEqual(hashes);
    },
  );

  test("still holds every other mode to the floor", () => {
    const r = startRequestSchema.safeParse(
      start({ config: cfg({ num_questions: QUESTION_BOUNDS.min - 1 }) }),
    );
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("config.num_questions");
  });

  test("still reads back a stored starred drill unchanged", () => {
    const r = storedConfigSchema.safeParse({
      mode: "starred",
      starred_hashes: [HASH_A, HASH_B],
      num_questions: 2,
    });
    expect(r.success).toBe(true);
    expect(r.data!.sources).toEqual([]);
    expect(r.data!.starred_hashes).toEqual([HASH_A, HASH_B]);
  });
});

describe("the résumé-vs-JD gap request", () => {
  test("takes a job description at the cap and refuses one past it", () => {
    expect(resumeGapRequestSchema.safeParse({ jd: "a".repeat(GAP_JD_MAX_CHARS) }).success).toBe(
      true,
    );
    expect(resumeGapRequestSchema.safeParse({ jd: "a".repeat(GAP_JD_MAX_CHARS + 1) }).success).toBe(
      false,
    );
  });

  test("refuses a blank job description, which has nothing to compare against", () => {
    expect(resumeGapRequestSchema.safeParse({ jd: "   " }).success).toBe(false);
    expect(resumeGapRequestSchema.safeParse({}).success).toBe(false);
  });

  test("reads the empty résumé field of a file upload as absent, not as a blank paste", () => {
    const missing = resumeGapRequestSchema.safeParse({ jd: "Senior Go role", resume_text: null });
    expect(missing.success).toBe(true);
    expect(missing.data!.resume_text).toBeUndefined();

    const empty = resumeGapRequestSchema.safeParse({ jd: "Senior Go role", resume_text: "" });
    expect(empty.success).toBe(true);
    expect(empty.data!.resume_text).toBeUndefined();
  });

  test("takes a pasted résumé at the cap and refuses one past it", () => {
    const jd = "Senior Go role";
    expect(
      resumeGapRequestSchema.safeParse({ jd, resume_text: "a".repeat(GAP_RESUME_MAX_CHARS) })
        .success,
    ).toBe(true);
    expect(
      resumeGapRequestSchema.safeParse({ jd, resume_text: "a".repeat(GAP_RESUME_MAX_CHARS + 1) })
        .success,
    ).toBe(false);
  });
});

describe("the gap comparison the model returns", () => {
  const COVERED = { requirement: "React + TypeScript, 3 yrs", evidence: "Built Grill on Next.js." };
  const GAP = {
    requirement: "Observability / on-call",
    why_it_matters: "They page whoever shipped it.",
    how_to_close: "Add Sentry to Grill, write the incident story.",
  };
  const OK = {
    match_percent: 61,
    summary: "Worth applying, with prep.",
    covered: [COVERED],
    gaps: [GAP],
  };

  function parse(over: Record<string, unknown>) {
    const r = resumeGapResponseSchema.safeParse({ ...OK, ...over });
    expect(r.success).toBe(true);
    return r.data!;
  }

  test("passes a well-formed comparison through untouched", () => {
    expect(parse({})).toEqual(OK);
  });

  test.each([
    [140, 100],
    [101, 100],
    [-12, 0],
    ["61", 61],
    [61.6, 62],
  ])("reads a match percent of %p as %i rather than failing the comparison", (given, expected) => {
    expect(parse({ match_percent: given }).match_percent).toBe(expected);
  });

  test.each([
    ["missing", { ...OK, match_percent: undefined }],
    ["misnamed", { summary: OK.summary, covered: OK.covered, gaps: OK.gaps, matchPercent: 61 }],
    ["unreadable", { ...OK, match_percent: "not a number" }],
  ])("refuses a comparison whose match percent is %s, rather than inventing 0%%", (_label, body) => {
    expect(resumeGapResponseSchema.safeParse(body).success).toBe(false);
  });

  test("drops a malformed entry rather than throwing the whole comparison away", () => {
    const r = parse({
      covered: [COVERED, { requirement: "no evidence" }, "nonsense", null, 7],
      gaps: [GAP, { requirement: "half", why_it_matters: "an item" }],
    });
    expect(r.covered).toEqual([COVERED]);
    expect(r.gaps).toEqual([GAP]);
  });

  test("reads a missing or non-array list as an empty one", () => {
    const r = resumeGapResponseSchema.safeParse({ match_percent: 10, summary: "Thin." });
    expect(r.success).toBe(true);
    expect(r.data!.covered).toEqual([]);
    expect(r.data!.gaps).toEqual([]);
    expect(parse({ covered: "none" }).covered).toEqual([]);
  });

  test("caps each list at twelve, however many the model felt like listing", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...COVERED, requirement: `req ${i}` }));
    expect(parse({ covered: many }).covered).toHaveLength(12);
  });

  test("truncates a runaway summary or line instead of spending a retry on it", () => {
    const r = parse({
      summary: "x".repeat(2_000),
      covered: [{ requirement: "r".repeat(500), evidence: "e".repeat(900) }],
    });
    expect(r.summary).toHaveLength(600);
    expect(r.covered[0]!.requirement).toHaveLength(240);
    expect(r.covered[0]!.evidence).toHaveLength(400);
  });

  test("still refuses a comparison with no summary, which is worth the one retry", () => {
    expect(resumeGapResponseSchema.safeParse({ ...OK, summary: "   " }).success).toBe(false);
    expect(resumeGapResponseSchema.safeParse({ ...OK, summary: undefined }).success).toBe(false);
  });
});

describe("questionResponseSchema", () => {
  test("folds a behavioral question type into cultural rather than spending a retry", () => {
    const r = questionResponseSchema.safeParse({ question: "Tell me about a conflict.", question_type: "behavioral" });
    expect(r.success).toBe(true);
    expect(r.data!.question_type).toBe("cultural");
  });

  test.each(["technical", "cultural", "followup"])("passes %s through untouched", (t) => {
    expect(questionResponseSchema.safeParse({ question: "q", question_type: t }).data!.question_type).toBe(t);
  });

  test("rejects an empty question and an invented question type", () => {
    expect(questionResponseSchema.safeParse({ question: "", question_type: "technical" }).success).toBe(false);
    expect(questionResponseSchema.safeParse({ question: "q", question_type: "philosophical" }).success).toBe(false);
  });
});

describe("on-camera metrics coming off an answer", () => {
  function cam(over: Record<string, unknown> = {}) {
    return {
      frames: 300,
      no_face_frames: 12,
      on_camera_pct: 78.4,
      smile_pct: 11.2,
      head_motion_dps: 4.6,
      away_segments: [{ start_ms: 3_000, end_ms: 6_200 }],
      longest_away_ms: 3_200,
      sample_hz: 5,
      pose_source: "matrix",
      ...over,
    };
  }

  test("accepts the aggregate the hook produces, and nothing resembling a frame", () => {
    const r = cameraMetricsSchema.safeParse(cam());
    expect(r.success).toBe(true);
    expect(Object.keys(r.data!).sort()).toEqual([
      "away_segments",
      "frames",
      "head_motion_dps",
      "longest_away_ms",
      "no_face_frames",
      "on_camera_pct",
      "pose_source",
      "sample_hz",
      "smile_pct",
    ]);
  });

  test.each([
    ["on_camera_pct", 100.1],
    ["on_camera_pct", -1],
    ["smile_pct", 140],
    ["head_motion_dps", -0.5],
    ["sample_hz", 0],
    ["sample_hz", 61],
    ["frames", -1],
  ])("refuses %s of %p, which no measurement can produce", (key, value) => {
    expect(cameraMetricsSchema.safeParse(cam({ [key]: value })).success).toBe(false);
  });

  test("refuses a pose source that is neither of the two the hook can use", () => {
    expect(cameraMetricsSchema.safeParse(cam({ pose_source: "guess" })).success).toBe(false);
  });

  test("refuses a look-away that ends before it starts", () => {
    const r = cameraMetricsSchema.safeParse(
      cam({ away_segments: [{ start_ms: 6_000, end_ms: 3_000 }] }),
    );
    expect(r.success).toBe(false);
  });

  test("caps the segment list at 500, which is far more glances than an answer holds", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ start_ms: i * 10, end_ms: i * 10 + 5 }));
    expect(cameraMetricsSchema.safeParse(cam({ away_segments: many(500) })).success).toBe(true);
    expect(cameraMetricsSchema.safeParse(cam({ away_segments: many(501) })).success).toBe(false);
  });

  test("mirrors CameraTurnMetrics, so the parsed value can be stored as-is", () => {
    const parsed = cameraMetricsSchema.parse(cam());
    const shared: CameraTurnMetrics = parsed;
    expect(shared.pose_source).toBe("matrix");
    expect(shared.away_segments[0]!.end_ms).toBe(6_200);
  });
});

describe("the JSON-in-a-form-field wrapper", () => {
  function form(over: Record<string, unknown> = {}) {
    return {
      session_id: "11111111-1111-4111-8111-111111111111",
      turn_index: "3",
      ...over,
    };
  }

  const CAM = {
    frames: 120,
    no_face_frames: 0,
    on_camera_pct: 91,
    smile_pct: 4,
    head_motion_dps: 2.1,
    away_segments: [],
    longest_away_ms: 0,
    sample_hz: 5,
    pose_source: "landmarks" as const,
  };

  test("reads an absent field as absent, not as a broken payload", () => {
    const r = turnRefSchema.safeParse(form());
    expect(r.success).toBe(true);
    expect(r.data!.camera_metrics).toBeUndefined();
  });

  test.each([
    ["an empty string, which is how a form sends nothing", ""],
    ["a null, which is how FormData.get reports a missing field", null],
  ])("reads %s as absent", (_label, value) => {
    const r = turnRefSchema.safeParse(form({ camera_metrics: value }));
    expect(r.success).toBe(true);
    expect(r.data!.camera_metrics).toBeUndefined();
  });

  test("parses the metrics the client stringified into the field", () => {
    const r = turnRefSchema.safeParse(form({ camera_metrics: JSON.stringify(CAM) }));
    expect(r.success).toBe(true);
    expect(r.data!.camera_metrics).toEqual(CAM);
  });

  test("turns malformed JSON into a 400 naming the field, never a thrown parse", () => {
    const r = turnRefSchema.safeParse(form({ camera_metrics: "{not json" }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("camera_metrics");
  });

  test("still refuses well-formed JSON that is not a set of metrics", () => {
    const r = turnRefSchema.safeParse(form({ camera_metrics: JSON.stringify({ frames: -1 }) }));
    expect(r.success).toBe(false);
    expect(issuePaths(r).some((p) => p.startsWith("camera_metrics"))).toBe(true);
  });

  test("passes an object straight through, so a JSON body can use the same field", () => {
    const r = turnRefSchema.safeParse(form({ camera_metrics: CAM }));
    expect(r.success).toBe(true);
    expect(r.data!.camera_metrics).toEqual(CAM);
  });

  test("takes the same metrics on a typed answer, including an explicit null", () => {
    const body = {
      session_id: "11111111-1111-4111-8111-111111111111",
      turn_index: 0,
      text: "I'd shard by tenant.",
    };
    expect(answerTextSchema.safeParse({ ...body, camera_metrics: CAM }).data!.camera_metrics).toEqual(CAM);
    expect(answerTextSchema.safeParse({ ...body, camera_metrics: null }).success).toBe(true);
    expect(answerTextSchema.safeParse(body).success).toBe(true);
  });
});

describe("the interviewer voice request", () => {
  test("names a turn and nothing else, since free text would be an open TTS proxy", () => {
    const r = voiceRequestSchema.safeParse({
      session_id: "11111111-1111-4111-8111-111111111111",
      turn_index: 2,
    });
    expect(r.success).toBe(true);
    expect(Object.keys(r.data!).sort()).toEqual(["session_id", "turn_index"]);
  });

  test("refuses a turn index that is not one", () => {
    const base = { session_id: "11111111-1111-4111-8111-111111111111" };
    expect(voiceRequestSchema.safeParse({ ...base, turn_index: -1 }).success).toBe(false);
    expect(voiceRequestSchema.safeParse({ ...base, turn_index: 1.5 }).success).toBe(false);
    expect(voiceRequestSchema.safeParse({ ...base }).success).toBe(false);
  });
});

describe("the STAR labels the model returns", () => {
  const OK = { labels: ["S", "S", "T", "A", "R"], missing: [], note: "Mostly action, thin result." };

  test("passes a well-formed labelling through", () => {
    const r = starResponseSchema.safeParse(OK);
    expect(r.success).toBe(true);
    expect(r.data!.labels).toEqual(["S", "S", "T", "A", "R"]);
  });

  test("refuses a label outside the five, rather than drawing a bar that means nothing", () => {
    expect(starResponseSchema.safeParse({ ...OK, labels: ["S", "X"] }).success).toBe(false);
    expect(starResponseSchema.safeParse({ ...OK, labels: ["s"] }).success).toBe(false);
    expect(starResponseSchema.safeParse({ ...OK, labels: ["Situation"] }).success).toBe(false);
  });

  test("refuses an empty label list, which labels no sentence at all", () => {
    expect(starResponseSchema.safeParse({ ...OK, labels: [] }).success).toBe(false);
  });

  test("does not police the label count — padding to the sentences is service work", () => {
    const r = starResponseSchema.safeParse({ ...OK, labels: ["S"] });
    expect(r.success).toBe(true);
    expect(r.data!.labels).toEqual(["S"]);
  });

  test("reads a missing or malformed 'missing' list as nothing missing", () => {
    expect(starResponseSchema.safeParse({ labels: ["S"], note: "n" }).data!.missing).toEqual([]);
    expect(
      starResponseSchema.safeParse({ labels: ["S"], note: "n", missing: ["Result"] }).data!.missing,
    ).toEqual([]);
  });

  test("trims a runaway note instead of failing the turn over its length", () => {
    const r = starResponseSchema.safeParse({ ...OK, note: "x".repeat(900) });
    expect(r.success).toBe(true);
    expect(r.data!.note).toHaveLength(300);
  });

  test("still refuses a labelling with no note, which is half the callout", () => {
    expect(starResponseSchema.safeParse({ ...OK, note: "   " }).success).toBe(false);
  });
});

describe("the job posting import request", () => {
  const URL = "https://boards.greenhouse.io/acme/jobs/4012345";

  test("takes a URL on its own — the server fetches the posting", () => {
    const r = jdExtractRequestSchema.safeParse({ url: URL });
    expect(r.success).toBe(true);
    expect(r.data!.page_text).toBeUndefined();
  });

  test.each([
    ["http, which the fetcher refuses anyway", "http://boards.greenhouse.io/acme/jobs/1"],
    ["a javascript: URL, which would be rendered back as a link", "javascript:alert(1)"],
    ["something that is not a URL at all", "acme.com/jobs"],
    ["an empty string", ""],
  ])("refuses %s", (_label, url) => {
    expect(jdExtractRequestSchema.safeParse({ url }).success).toBe(false);
  });

  test("takes the page the bookmarklet scraped out of the user's own tab", () => {
    const r = jdExtractRequestSchema.safeParse({
      url: "https://www.linkedin.com/jobs/view/4012345",
      page_title: "Senior Backend Engineer",
      page_text: "We are looking for…",
    });
    expect(r.success).toBe(true);
    expect(r.data!.page_title).toBe("Senior Backend Engineer");
    expect(r.data!.page_text).toBe("We are looking for…");
  });

  test("caps the scraped page, since the bookmarklet slices at 60k of its own", () => {
    const at = jdExtractRequestSchema.safeParse({ url: URL, page_text: "a".repeat(JOB_PAGE_TEXT_MAX_CHARS) });
    expect(at.success).toBe(true);

    const over = jdExtractRequestSchema.safeParse({
      url: URL,
      page_text: "a".repeat(JOB_PAGE_TEXT_MAX_CHARS + 1),
    });
    expect(over.success).toBe(false);
    expect(issuePaths(over)).toContain("page_text");
  });

  test("reads an empty page field as absent, which is the fetch-it-yourself path", () => {
    const r = jdExtractRequestSchema.safeParse({ url: URL, page_text: "", page_title: "" });
    expect(r.success).toBe(true);
    expect(r.data!.page_text).toBeUndefined();
    expect(r.data!.page_title).toBeUndefined();
  });
});

describe("the posting the model reads off a page", () => {
  test("lets an empty description through, so the service can say 'not a posting'", () => {
    const r = jobExtractSchema.safeParse({ title: "", company: null, location: null, description: "" });
    expect(r.success).toBe(true);
    expect(r.data!.description).toBe("");
  });

  test("keeps a company the page never named as null rather than inventing one", () => {
    const r = jobExtractSchema.safeParse({
      title: "Backend Engineer",
      company: "",
      location: null,
      description: "d".repeat(400),
    });
    expect(r.success).toBe(true);
    expect(r.data!.company).toBeNull();
    expect(r.data!.location).toBeNull();
  });

  test("trims a long title or description instead of dropping the import", () => {
    const r = jobExtractSchema.safeParse({ title: "t".repeat(500), description: "d".repeat(25_000) });
    expect(r.success).toBe(true);
    expect(r.data!.title).toHaveLength(200);
    expect(r.data!.description).toHaveLength(20_000);
  });

  test("survives a model that returned nothing usable at all", () => {
    const r = jobExtractSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ title: "", company: null, location: null, description: "" });
  });
});

describe("the company brief request", () => {
  test("needs a company to research", () => {
    expect(companyBriefRequestSchema.safeParse({ company: "   " }).success).toBe(false);
    expect(companyBriefRequestSchema.safeParse({}).success).toBe(false);
  });

  test("takes a company at the key's ceiling and refuses one past it", () => {
    expect(companyBriefRequestSchema.safeParse({ company: "a".repeat(COMPANY_MAX_CHARS) }).success).toBe(true);
    expect(
      companyBriefRequestSchema.safeParse({ company: "a".repeat(COMPANY_MAX_CHARS + 1) }).success,
    ).toBe(false);
  });

  test("treats a blank role as no role, which is a different cache row", () => {
    const r = companyBriefRequestSchema.safeParse({ company: "Acme", role: "" });
    expect(r.success).toBe(true);
    expect(r.data!.role).toBeUndefined();
  });

  test("leaves the cache in place unless a refresh was asked for", () => {
    expect(companyBriefRequestSchema.safeParse({ company: "Acme" }).data!.refresh).toBe(false);
    expect(companyBriefRequestSchema.safeParse({ company: "Acme", refresh: true }).data!.refresh).toBe(true);
  });
});

describe("the company brief the model returns", () => {
  const NEWS = { headline: "Acme raises a Series C", date: "2026-03", why_it_matters: "They are hiring fast." };
  const OK = {
    what_they_do: "Payments infrastructure for marketplaces.",
    recent_news: [NEWS],
    values: ["Write it down"],
    interview_style_notes: ["One story per round"],
    likely_questions: ["Walk me through a ledger you designed."],
    questions_to_ask: ["How do you handle reconciliation breaks?"],
  };

  test("passes a well-formed brief through", () => {
    const r = companyBriefSchema.safeParse(OK);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(OK);
  });

  test("keeps the sections that came back when the others did not", () => {
    const r = companyBriefSchema.safeParse({ values: ["Write it down"] });
    expect(r.success).toBe(true);
    expect(r.data!.what_they_do).toBe("");
    expect(r.data!.recent_news).toEqual([]);
    expect(r.data!.values).toEqual(["Write it down"]);
  });

  test("drops a malformed headline rather than losing the whole brief", () => {
    const r = companyBriefSchema.safeParse({
      ...OK,
      recent_news: [NEWS, { headline: "no reason given" }, "nonsense", null],
    });
    expect(r.success).toBe(true);
    expect(r.data!.recent_news).toEqual([NEWS]);
  });

  test("keeps a dateless headline, since the story is still the story", () => {
    const r = companyBriefSchema.safeParse({
      ...OK,
      recent_news: [{ headline: "Acme ships an API", why_it_matters: "It's the team you'd join." }],
    });
    expect(r.data!.recent_news[0]!.date).toBe("");
  });

  test("caps every list at eight, however enthusiastic the model felt", () => {
    const many = Array.from({ length: 30 }, (_, i) => `value ${i}`);
    expect(companyBriefSchema.safeParse({ ...OK, values: many }).data!.values).toHaveLength(8);
  });

  test("mirrors CompanyBrief, so the parsed value is what gets stored", () => {
    const shared: CompanyBrief = companyBriefSchema.parse(OK);
    expect(shared.likely_questions).toHaveLength(1);
  });
});

describe("the daily drill's requests", () => {
  const CARD = "22222222-2222-4222-8222-222222222222";
  const SCORES = { relevance: 7, correctness: 6, structure: 5, depth: 4, filler: 8 };

  test("takes a typed drill answer and refuses an empty one", () => {
    expect(drillTextAnswerSchema.safeParse({ card_id: CARD, text: "Because the index was unused." }).success).toBe(true);
    expect(drillTextAnswerSchema.safeParse({ card_id: CARD, text: "   " }).success).toBe(false);
    expect(drillTextAnswerSchema.safeParse({ card_id: "not-a-uuid", text: "x" }).success).toBe(false);
  });

  test("grades a card inside SM-2's own 0–5 range", () => {
    expect(drillReviewSchema.safeParse({ card_id: CARD, grade: 1 }).success).toBe(true);
    expect(drillReviewSchema.safeParse({ card_id: CARD, grade: "5" }).data!.grade).toBe(5);
    expect(drillReviewSchema.safeParse({ card_id: CARD, grade: 6 }).success).toBe(false);
    expect(drillReviewSchema.safeParse({ card_id: CARD, grade: -1 }).success).toBe(false);
    expect(drillReviewSchema.safeParse({ card_id: CARD, grade: 2.5 }).success).toBe(false);
  });

  test("carries the transcript and scores the answer route already produced", () => {
    const r = drillReviewSchema.safeParse({
      card_id: CARD,
      grade: 3,
      transcript: "I'd add a covering index.",
      answer_scores: SCORES,
    });
    expect(r.success).toBe(true);
    expect(r.data!.answer_scores).toEqual(SCORES);
  });

  test("refuses a rubric that is not one, rather than storing it as a best answer", () => {
    expect(
      drillReviewSchema.safeParse({ card_id: CARD, grade: 3, answer_scores: { relevance: 7 } }).success,
    ).toBe(false);
  });
});

describe("the profile's timezone", () => {
  test("takes an IANA zone the server can actually format dates in", () => {
    const r = updateProfileSchema.safeParse({ timezone: "Asia/Kolkata" });
    expect(r.success).toBe(true);
    expect(r.data!.timezone).toBe("Asia/Kolkata");
    expect(updateProfileSchema.safeParse({ timezone: "UTC" }).success).toBe(true);
  });

  test("refuses a zone nothing recognises, instead of letting the nightly sweep throw", () => {
    expect(updateProfileSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ timezone: "GMT+5:30" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ timezone: "   " }).success).toBe(false);
  });

  test("lets a user clear a zone the browser guessed wrong", () => {
    const r = updateProfileSchema.safeParse({ timezone: null });
    expect(r.success).toBe(true);
    expect(r.data!.timezone).toBeNull();
  });

  test("leaves both new profile fields absent when they were not sent", () => {
    const r = updateProfileSchema.safeParse({ name: "Yatin" });
    expect(r.success).toBe(true);
    expect(r.data!.timezone).toBeUndefined();
    expect(r.data!.email_digest).toBeUndefined();
  });
});

describe("an imported posting on the interview config", () => {
  function jd(over: Record<string, unknown> = {}) {
    return cfg({ mode: "jd", sources: [], job_description: "Senior Go role", ...over });
  }

  test("carries the provenance the importer read off the posting", () => {
    const r = interviewConfigSchema.safeParse(
      jd({
        job_url: "https://jobs.lever.co/acme/6d2f0a1e-1111-4111-8111-111111111111",
        company: "Acme",
        job_title: "Senior Backend Engineer",
        job_location: "Bengaluru, India",
      }),
    );
    expect(r.success).toBe(true);
    expect(r.data!.company).toBe("Acme");
    expect(r.data!.job_title).toBe("Senior Backend Engineer");
  });

  test("reads the nulls an importer returns for what a posting never named", () => {
    const r = interviewConfigSchema.safeParse(jd({ company: null, job_location: "", job_url: null }));
    expect(r.success).toBe(true);
    expect(r.data!.company).toBeUndefined();
    expect(r.data!.job_location).toBeUndefined();
    expect(r.data!.job_url).toBeUndefined();
  });

  test("refuses a job link that is not an https URL", () => {
    expect(interviewConfigSchema.safeParse(jd({ job_url: "javascript:alert(1)" })).success).toBe(false);
    expect(interviewConfigSchema.safeParse(jd({ job_url: "http://jobs.example.com/1" })).success).toBe(false);
  });

  test("still reads a JD session recorded before the importer existed", () => {
    const r = storedConfigSchema.safeParse({ mode: "jd", job_description: "Senior Go role" });
    expect(r.success).toBe(true);
    expect(r.data!.company).toBeUndefined();
  });
});

describe("delivery metrics read back off a report row", () => {
  const MEASURED: DeliveryMetrics = {
    wpm: 148.2,
    avg_pause_ms: 210.5,
    filler_count: 9,
    pitch_variation: 21.6,
    energy: 0.038,
    mean_pitch_hz: 121,
    jitter_local: 0.012,
    shimmer_local: 0.041,
    hnr_db: 18.4,
    uptalk_pct: 22.2,
    uptalk_statements: 9,
    uptalk_rising: 2,
    on_camera_pct: 74.1,
    smile_pct: 8.3,
    head_motion_dps: 5.2,
    camera_turns: 4,
  };

  test("passes a fully measured report through untouched", () => {
    const r = deliveryMetricsSchema.safeParse(MEASURED);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(MEASURED);
  });

  test("reads a report written before a metric existed as NOT MEASURED, never as zero", () => {
    const old = {
      wpm: 148.2,
      avg_pause_ms: 210.5,
      filler_count: 9,
      pitch_variation: 21.6,
      energy: 0.038,
      mean_pitch_hz: 121,
    };
    const r = deliveryMetricsSchema.safeParse(old);
    expect(r.success).toBe(true);
    expect(r.data!.jitter_local).toBeNull();
    expect(r.data!.hnr_db).toBeNull();
    expect(r.data!.uptalk_pct).toBeNull();
    expect(r.data!.on_camera_pct).toBeNull();
    expect(r.data!.smile_pct).toBeNull();
    expect(r.data!.head_motion_dps).toBeNull();
  });

  test("reads a row with no timing or filler keys at all as unmeasured, not as a perfect run", () => {
    const r = deliveryMetricsSchema.safeParse({ pitch_variation: 21.6 });
    expect(r.success).toBe(true);
    expect(r.data!.wpm).toBeNull();
    expect(r.data!.avg_pause_ms).toBeNull();
    expect(r.data!.filler_count).toBeNull();
  });

  test("keeps a stored zero, because a run with no fillers really did have none", () => {
    const r = deliveryMetricsSchema.parse({ wpm: 0, avg_pause_ms: 0, filler_count: 0 });
    expect(r.wpm).toBe(0);
    expect(r.avg_pause_ms).toBe(0);
    expect(r.filler_count).toBe(0);
  });

  test("reads counts that never happened as zero, which is what they are", () => {
    const r = deliveryMetricsSchema.parse({ wpm: 0, avg_pause_ms: 0, filler_count: 0 });
    expect(r.camera_turns).toBe(0);
    expect(r.uptalk_statements).toBe(0);
    expect(r.uptalk_rising).toBe(0);
  });

  test("reads an unusable value as unmeasured rather than dropping the comparison", () => {
    const r = deliveryMetricsSchema.safeParse({ ...MEASURED, energy: "loud", camera_turns: null });
    expect(r.success).toBe(true);
    expect(r.data!.energy).toBeNull();
    expect(r.data!.camera_turns).toBe(0);
  });

  test("mirrors every key of DeliveryMetrics, which is what the retry diff compares", () => {
    const parsed = deliveryMetricsSchema.parse(MEASURED);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(MEASURED).sort());
    expect(parsed.camera_turns).toBe(4);
  });
});

describe("a STAR breakdown read back off a report row", () => {
  const STORED = {
    turn_index: 2,
    basis: "time",
    segments: [{ label: "S", start: 0, end: 4.2, text: "We had a flaky deploy." }],
    share: { S: 62, T: 8, A: 26, R: 4, other: 0 },
    missing: ["R"],
    note: "Two thirds is scene-setting.",
  };

  test("passes a stored breakdown through", () => {
    const r = starBreakdownSchema.safeParse(STORED);
    expect(r.success).toBe(true);
    expect(r.data!.share.S).toBe(62);
  });

  test("mirrors StarBreakdown, so the shared report can render it unguarded", () => {
    const shared: StarBreakdown = starBreakdownSchema.parse(STORED);
    expect(shared.missing).toEqual(["R"]);
  });

  test("refuses a breakdown with no basis, which is what the bar's units depend on", () => {
    expect(starBreakdownSchema.safeParse({ ...STORED, basis: "vibes" }).success).toBe(false);
  });
});
