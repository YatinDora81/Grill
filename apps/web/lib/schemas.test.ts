import { describe, expect, mock, test } from "bun:test";

// `server-only` throws the moment it is imported outside an RSC graph. It is a
// build-time marker with no runtime behaviour, so it is neutralised before
// schemas.ts pulls it in via env.ts.
mock.module("server-only", () => ({}));

// env.ts fails fast on a missing key, and Bun does not load `.env.local` under
// NODE_ENV=test. These satisfy that boot check and nothing else: no test here
// touches a provider, and every other config value stays at its real default so
// the bounds below are the ones production enforces.
process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

const { DIFFICULTIES, QUESTION_BOUNDS } = await import("./interviewMeta");
const {
  interviewConfigSchema,
  questionResponseSchema,
  startRequestSchema,
  storedConfigSchema,
} = await import("./schemas");

/**
 * These schemas are the only thing standing between the API and a config the
 * prompt builder cannot describe. Nothing downstream re-checks the invariant, so
 * a hole here does not surface as a validation error — it surfaces as an
 * interview briefed on material it does not have.
 */

/** A minimal valid config; `over` names only the field under test. */
function cfg(over: Record<string, unknown> = {}) {
  return { sources: ["resume"], mode: null, ...over };
}

/** A minimal valid start request. */
function start(over: Record<string, unknown> = {}) {
  return { source_text: "Staff engineer. Shipped a billing ledger.", name: "Backend screen", config: cfg(), ...over };
}

/** The `path` of every issue a failed parse produced, dotted. */
function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error!.issues.map((i) => i.path.join("."));
}

describe("the mode XOR sources invariant", () => {
  /**
   * The prompt builder reads `mode` first and `sources` only when mode is null.
   * A config carrying both does not fail — it silently runs as the mode, and the
   * sources the user picked are never mentioned to the interviewer.
   */
  test("rejects an exclusive mode carrying sources as well", () => {
    const r = interviewConfigSchema.safeParse(cfg({ mode: "jd", job_description: "Senior Go role", sources: ["resume"] }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain("sources");
  });

  /** The mirror hole: neither field set describes an interview about nothing. */
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

  /** Whitespace is trimmed before the check, so " " is no topic at all. */
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

  test("asks for no topic when neither the source nor the mode wants one", () => {
    expect(interviewConfigSchema.safeParse(cfg({ sources: ["resume", "cultural"] })).success).toBe(true);
  });
});

describe("bounds", () => {
  test("pins the bounds the form, the API and the prompt all quote", () => {
    // Restated as literals so a change to the product limits has to be a
    // deliberate edit here, not a silent follow-on from another file.
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

  /**
   * The floor is deliberately only on the way IN. A session recorded when the
   * floor was 1 must still parse, or its report can never build and its room
   * page 500s — punishing the user for a limit that postdates their interview.
   */
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
    // num_questions counts turns the room will actually create; 7.5 of them is
    // a loop that never reaches its own terminating condition.
    expect(interviewConfigSchema.safeParse(cfg({ num_questions: 7.5 })).success).toBe(false);
  });

  test("caps the résumé at 20k characters, one character past being the failure", () => {
    expect(startRequestSchema.safeParse(start({ source_text: "a".repeat(20_000) })).success).toBe(true);

    const over = startRequestSchema.safeParse(start({ source_text: "a".repeat(20_001) }));
    expect(over.success).toBe(false);
    expect(issuePaths(over)).toContain("source_text");
  });

  test("rejects an empty résumé and an unnamed interview", () => {
    // Both are required with no default: an interview with no name is one the
    // user cannot find again, and nothing invented here would be their words.
    expect(startRequestSchema.safeParse(start({ source_text: "" })).success).toBe(false);
    expect(startRequestSchema.safeParse(start({ name: "   " })).success).toBe(false);
  });
});

describe("defaults", () => {
  test("leaves repeats off unless they are asked for", () => {
    // Off by default is what makes this a repeat-practice tool: with it on, the
    // same résumé produces the same interview twice.
    expect(interviewConfigSchema.safeParse(cfg()).data!.allow_repeats).toBe(false);
    expect(interviewConfigSchema.safeParse(cfg({ allow_repeats: true })).data!.allow_repeats).toBe(true);
  });

  test("pitches a config with no stated difficulty at medium, not at easy", () => {
    // Difficulty drives how hard every question is pitched, so the fallback for
    // a row that never stated one is a product decision: defaulting to easy
    // would silently under-pitch every legacy session.
    expect(interviewConfigSchema.safeParse(cfg()).data!.difficulty).toBe("medium");
    expect(storedConfigSchema.safeParse(cfg()).data!.difficulty).toBe("medium");
  });

  test("carries a stored per-answer cap through, and treats its absence as 'use the default'", () => {
    // A stored session keeps the cap it was created with even if the model's
    // constants are retuned later; absent must stay absent rather than being
    // filled in, or the room would enforce a limit the interview never had.
    expect(storedConfigSchema.safeParse({ ...cfg(), max_answer_seconds: 180 }).data!.max_answer_seconds).toBe(180);
    expect(storedConfigSchema.safeParse(cfg()).data!.max_answer_seconds).toBeUndefined();
  });
});

describe("configs written under older shapes", () => {
  /**
   * Sessions are long-lived and replayed by the report, the retry flow and the
   * room. Every shape this app has ever written has to keep parsing — a row
   * written by an older deploy must still work after a rollback.
   */
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
    // The `c.mode ? [] : ["resume"]` fallback. Defaulting to ["resume"] here
    // would break the XOR for every stored jd/real/weak_spots session at once.
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
      // "Focus" was a parallel axis that only restated what the sources say.
      const r = storedConfigSchema.safeParse({ sources: ["resume"], mode: null, interview_type });
      expect(r.success).toBe(true);
      expect(r.data!.sources).toEqual(["resume", "cultural"]);
    },
  );

  test("does not fold the legacy focus into an exclusive mode, which would break the XOR", () => {
    // The `s.length > 0` guard. Pushing cultural onto a jd session's empty
    // sources would make every such stored row unparseable.
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
    // The shapes compose: a single old row is not one migration but four.
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

  test("still rejects a stored row that migration cannot rescue", () => {
    // Migration is not a licence to accept anything: a row naming a source that
    // has never existed is corrupt, and reading it as valid would brief the
    // prompt on a source it has no meta for.
    expect(storedConfigSchema.safeParse({ sources: ["astrology"], mode: null }).success).toBe(false);
    expect(storedConfigSchema.safeParse("not a config").success).toBe(false);
    expect(storedConfigSchema.safeParse(null).success).toBe(false);
  });
});

describe("questionResponseSchema", () => {
  test("folds a behavioral question type into cultural rather than spending a retry", () => {
    // The prompt no longer offers `behavioral`, but the two always meant the
    // same thing — and a rejected value costs a whole model round-trip.
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
