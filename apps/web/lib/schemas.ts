import { z } from "zod";
import type { Difficulty, InterviewSource } from "@repo/types";
import { QUESTION_BOUNDS } from "./interviewMeta";
import { config } from "./env";

// ── Auth ──────────────────────────────────────────────────────────
export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(config.auth.passwordMinLength).max(200),
  name: z.string().trim().min(1).max(80).optional(),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
});

export const resetPasswordSchema = z.object({
  // 32 random bytes, base64url — the shape passwordResetService mints. Bounded
  // by alphabet and length so a truncated link, or a probe carrying a quote or
  // a path segment, is refused here instead of being hashed and looked up. The
  // range rather than an exact 43 leaves room to lengthen the token later
  // without stranding the links already sitting in inboxes.
  token: z.string().trim().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/),
  password: z.string().min(config.auth.passwordMinLength).max(200),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).nullable().optional(),
  email_on_report: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  // The current password is required even though the session already proves
  // who they are: it's what stops a walk-up on an unlocked laptop from
  // silently taking the account.
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(config.auth.passwordMinLength).max(200),
});

// ── Interview requests ────────────────────────────────────────────

export const interviewSourceSchema = z.enum(["resume", "topic", "cultural"]);
export const exclusiveModeSchema = z.enum([
  "topic_only",
  "cultural_only",
  "jd",
  "real",
  "weak_spots",
  "starred",
  "project",
]);
export const difficultySchema = z.enum(["easy", "medium", "hard", "extreme"]);
export const personaSchema = z.enum([
  "neutral",
  "friendly_screen",
  "terse_staff",
  "bar_raiser",
  "skeptic",
]);

/** Legacy: the single-mode union that `sources` + `mode` replaced. */
export const interviewModeSchema = z.enum([
  "resume",
  "topic",
  "topic_only",
  "cultural_only",
  "jd",
  "real",
  "weak_spots",
]);

/** Old junior/mid/senior buckets → current four-mode difficulty. */
const LEGACY_DIFFICULTY: Record<string, Difficulty> = {
  junior: "easy",
  mid: "medium",
  senior: "hard",
  easy: "easy",
  medium: "medium",
  hard: "hard",
  extreme: "extreme",
};

/** Old years-of-experience slider → current difficulty. Mid-bucket mapping. */
function yearsToDifficulty(years: number): Difficulty {
  if (years <= 2) return "easy";
  if (years <= 6) return "medium";
  if (years <= 12) return "hard";
  return "extreme";
}

/** Legacy single modes that carried the résumé along with them. */
const LEGACY_SOURCES: Record<string, InterviewSource[]> = {
  resume: ["resume"],
  topic: ["resume", "topic"],
};

/**
 * Reads a config written under any past shape and returns the current one.
 *
 * Sessions are long-lived and their config is replayed by the report, the
 * retry flow and the room — so every shape this app has ever written has to
 * keep parsing. Migrating on read (rather than a backfill) means a row written
 * by an older deploy still works after a rollback.
 */
function migrateConfig(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const c = { ...(raw as Record<string, unknown>) };

  // Pre-`sources` rows: one mode did the job of both fields.
  if (c.sources === undefined && typeof c.mode === "string") {
    const legacy = LEGACY_SOURCES[c.mode];
    if (legacy) {
      c.sources = [...legacy];
      c.mode = null;
    }
  }
  if (c.sources === undefined) c.sources = c.mode ? [] : ["resume"];

  // "Focus" was a parallel axis; `cultural` there meant the cultural source.
  if (c.interview_type === "cultural" || c.interview_type === "behavioral") {
    const s = c.sources as InterviewSource[];
    if (Array.isArray(s) && s.length > 0 && !s.includes("cultural")) s.push("cultural");
  }
  delete c.interview_type;

  // Difficulty: modern value wins; else map years (the field that replaced
  // junior/mid/senior); else map a legacy bucket; else medium.
  const rawDiff = typeof c.difficulty === "string" ? c.difficulty : undefined;
  const modern =
    rawDiff === "easy" || rawDiff === "medium" || rawDiff === "hard" || rawDiff === "extreme";
  if (modern) {
    /* already current */
  } else if (typeof c.years_experience === "number") {
    c.difficulty = yearsToDifficulty(c.years_experience);
  } else if (rawDiff && LEGACY_DIFFICULTY[rawDiff]) {
    c.difficulty = LEGACY_DIFFICULTY[rawDiff];
  } else {
    c.difficulty = "medium";
  }
  delete c.years_experience;

  return c;
}

const interviewConfigShape = z.object({
  // Deliberately looser than QUESTION_BOUNDS, which is enforced on the way IN
  // (see startRequestSchema). This shape also parses configs written years ago,
  // and the old floor was 1 — rejecting a stored 2-question session here would
  // mean its report can never build and its room page 500s, punishing the user
  // for a limit that didn't exist when they ran it.
  //
  // Clamping instead of widening would be worse than either: bumping a finished
  // 2-question interview up to 3 tells the room a question is still owed, and it
  // would go and generate one.
  num_questions: z.coerce
    .number()
    .int()
    .min(1)
    .max(QUESTION_BOUNDS.max)
    .default(config.interview.defaultNumQuestions),
  difficulty: difficultySchema.default("medium"),
  persona: personaSchema.default("neutral"),
  sources: z.array(interviewSourceSchema).max(3).default([]),
  mode: exclusiveModeSchema.nullable().default(null),
  topic: z.string().trim().max(2_000).optional(),
  job_description: z.string().trim().max(20_000).optional(),
  // `project`: the material the interviewer reads (pasted text or edited digest)
  // and, when a repo was imported, the URL it came from. Both optional so every
  // historic config still parses; the superRefine below requires the context
  // when the mode is `project`. The digest is denser than a résumé, hence the
  // higher ceiling than job_description.
  project_context: z.string().trim().max(24_000).optional(),
  project_repo_url: z.string().trim().url().max(500).optional(),
  starred_hashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(12).optional(),
  allow_repeats: z.coerce.boolean().default(false),
  // Optional, and must stay that way: sessions written before the cap existed
  // have no value here, and requiring one would make their room page and their
  // report unparseable — the same migration-on-read rule as num_questions above.
  // A stored session keeps the cap it was created with; absent means "fall back
  // to the flat env default".
  max_answer_seconds: z.coerce.number().int().positive().optional(),
});

/**
 * The invariant the whole feature rests on: an interview is EITHER blended from
 * sources OR one exclusive mode, never both and never neither. Enforced here
 * rather than in the form so the API can't be talked into an impossible config.
 */
export const interviewConfigSchema = interviewConfigShape.superRefine((v, ctx) => {
  if (v.mode && v.sources.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sources"],
      message: `A ${v.mode} interview brings its own material — it can't be mixed with other sources.`,
    });
  }
  if (!v.mode && v.sources.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sources"],
      message: "Pick what this interview should draw on.",
    });
  }
  const needsTopic = v.mode === "topic_only" || v.sources.includes("topic");
  if (needsTopic && !v.topic?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["topic"],
      message: "Pick a topic to be drilled on.",
    });
  }
  if (v.mode === "jd" && !v.job_description?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["job_description"],
      message: "Paste the job description you're going for.",
    });
  }
  if (v.mode === "project" && !v.project_context?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["project_context"],
      message: "Describe the project, or import a GitHub repo.",
    });
  }
  if (v.mode === "starred" && !v.starred_hashes?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["starred_hashes"],
      message: "Pick at least one saved question to drill.",
    });
  }
  if (v.starred_hashes?.length && v.mode !== "starred") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["starred_hashes"],
      message: "Saved questions are only asked back by a starred drill.",
    });
  }
});

/** Reads a config off a session row, whatever shape it was written in. */
export const storedConfigSchema = z.preprocess(migrateConfig, interviewConfigSchema);

export const startRequestSchema = z
  .object({
    // The résumé. Required for every mode except `project`, which brings its own
    // material — so the floor is enforced conditionally in the superRefine below,
    // not here. Empty stores fine: Session.sourceText is a non-null String.
    source_text: z.string().max(20_000).default(""),
    source_type: z.enum(["resume", "jd", "topic"]).default("resume"),
    // No default: an interview without a name is one the user can't find again,
    // and nothing we could invent here would be their words.
    name: z.string().trim().min(1, "Give this interview a name.").max(80),
    role: z.string().max(200).optional(),
    config: interviewConfigSchema,
  })
  // The floor lives here, not in the config shape, because it only applies to
  // interviews being CREATED. The same shape has to keep reading sessions
  // recorded when the floor was 1.
  .superRefine((v, ctx) => {
    if (v.config.num_questions < QUESTION_BOUNDS.min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config", "num_questions"],
        message: `An interview needs at least ${QUESTION_BOUNDS.min} questions.`,
      });
    }
    // Every mode but `project` is built around the résumé, so it stays required
    // there — a project interview supplies its own material and needs none.
    if (v.config.mode !== "project" && !v.source_text.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_text"],
        message: "A résumé is required for this interview.",
      });
    }
  });

// ── Starred questions ─────────────────────────────────────────────

export const starSchema = z.object({ turn_id: z.string().uuid() });
/** sha256, lowercase hex — the shape repo.questionHash produces. */
export const unstarSchema = z.object({ question_hash: z.string().regex(/^[a-f0-9]{64}$/) });

// ── Résumé vs JD gap tool ─────────────────────────────────────────

export const GAP_JD_MAX_CHARS = 8_000;
export const GAP_RESUME_MAX_CHARS = 15_000;

export const resumeGapRequestSchema = z.object({
  jd: z
    .string()
    .trim()
    .min(1, "Paste the job description you want to be measured against.")
    .max(GAP_JD_MAX_CHARS),
  resume_text: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.string().trim().min(1).max(GAP_RESUME_MAX_CHARS).optional(),
  ),
});

// ── Session video ─────────────────────────────────────────────────

export const videoStartSchema = z.object({
  session_id: z.string().uuid(),
  mime_type: z.string().min(1).max(100),
});

export const videoRefSchema = z.object({ video_id: z.string().uuid() });

export const videoPartUrlSchema = z.object({
  video_id: z.string().uuid(),
  part_number: z.coerce.number().int().min(1).max(config.video.maxParts),
});

/**
 * Where an answer sits in the session recording. Optional on every answer route:
 * the camera may have been denied, the recording may not have started yet, and
 * neither is a reason to reject the answer itself.
 */
export const answerVideoFields = {
  video_id: z.string().uuid().optional(),
  video_offset_ms: z.coerce.number().int().min(0).optional(),
};

/** Typed-text answer (text-only interview core, build order 4). */
export const answerTextSchema = z.object({
  session_id: z.string().uuid(),
  turn_index: z.coerce.number().int().min(0),
  text: z.string().min(1).max(20_000),
  ...answerVideoFields,
});

export const turnRefSchema = z.object({
  session_id: z.string().uuid(),
  turn_index: z.coerce.number().int().min(0),
  // Multipart form values arrive as strings or null; `.optional()` alone would
  // reject a null, so absent fields are normalised before the uuid check.
  video_id: z
    .preprocess((v) => (v === null || v === "" ? undefined : v), z.string().uuid().optional()),
  video_offset_ms: z
    .preprocess((v) => (v === null || v === "" ? undefined : v), z.coerce.number().int().min(0).optional()),
});

export const sessionIdSchema = z.object({ session_id: z.string().uuid() });

// ── Report shares ─────────────────────────────────────────────────
export const shareSessionParamsSchema = z.object({ sessionId: z.string().uuid() });

export const shareTokenSchema = z.string().trim().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/);

// ── LLM JSON responses ────────────────────────────────────────────
export const questionResponseSchema = z.object({
  question: z.string().min(1),
  // Accept `behavioral` and fold it in: the prompt no longer offers it, but a
  // rejected value costs a whole retry — and the two mean the same thing.
  question_type: z
    .enum(["technical", "cultural", "followup", "behavioral"])
    .transform((v) => (v === "behavioral" ? "cultural" : v)),
});

export const answerScoresSchema = z.object({
  relevance: z.coerce.number().min(0).max(10),
  correctness: z.coerce.number().min(0).max(10),
  structure: z.coerce.number().min(0).max(10),
  depth: z.coerce.number().min(0).max(10),
  filler: z.coerce.number().min(0).max(10),
});

const highlightSchema = z.object({
  turn_index: z.coerce.number().int(),
  quote: z.string(),
  why: z.string(),
});

const questionFeedbackSchema = z.object({
  turn_index: z.coerce.number().int(),
  possible_answers: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
});

export const reportResponseSchema = z.object({
  overall_score: z.coerce.number().min(0).max(100),
  verdict: z.string().min(1),
  category_scores: z.object({
    technical: z.coerce.number().min(0).max(100),
    communication: z.coerce.number().min(0).max(100),
    problem_solving: z.coerce.number().min(0).max(100),
  }),
  strengths: z.array(z.object({ point: z.string(), example: z.string() })).default([]),
  weaknesses: z
    .array(z.object({ point: z.string(), example: z.string(), fix: z.string() }))
    .default([]),
  best_answer: highlightSchema.nullable().default(null),
  worst_answer: highlightSchema.nullable().default(null),
  next_steps: z.array(z.string()).default([]),
  question_feedback: z.array(questionFeedbackSchema).default([]),
});

const GAP_SUMMARY_MAX_CHARS = 600;
const GAP_LINE_MAX_CHARS = 400;
const GAP_LIST_MAX_ITEMS = 12;

const gapLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.slice(0, max));

const coveredItemSchema = z.object({
  requirement: gapLine(240),
  evidence: gapLine(GAP_LINE_MAX_CHARS),
});

const gapItemSchema = z.object({
  requirement: gapLine(240),
  why_it_matters: gapLine(GAP_LINE_MAX_CHARS),
  how_to_close: gapLine(GAP_LINE_MAX_CHARS),
});

function keepingOnlyWellFormed<T>(item: z.ZodType<T>, cap: number) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((raw) =>
      raw
        .flatMap((v) => {
          const parsed = item.safeParse(v);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, cap),
    );
}

export const resumeGapResponseSchema = z.object({
  match_percent: z.coerce
    .number()
    .catch(0)
    .transform((n) => Math.min(100, Math.max(0, Math.round(n)))),
  summary: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.slice(0, GAP_SUMMARY_MAX_CHARS)),
  covered: keepingOnlyWellFormed(coveredItemSchema, GAP_LIST_MAX_ITEMS),
  gaps: keepingOnlyWellFormed(gapItemSchema, GAP_LIST_MAX_ITEMS),
});

export type QuestionResponse = z.infer<typeof questionResponseSchema>;
export type ReportResponse = z.infer<typeof reportResponseSchema>;
export type ResumeGapParsed = z.infer<typeof resumeGapResponseSchema>;
