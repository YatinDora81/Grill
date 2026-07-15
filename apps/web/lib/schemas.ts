import { z } from "zod";
import type { InterviewSource } from "@repo/types";
import { QUESTION_BOUNDS, YEAR_BOUNDS } from "./interviewMeta";
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

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).nullable(),
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
export const exclusiveModeSchema = z.enum(["topic_only", "jd", "real", "weak_spots"]);

/** Legacy: the single-mode union that `sources` + `mode` replaced. */
export const interviewModeSchema = z.enum([
  "resume",
  "topic",
  "topic_only",
  "jd",
  "real",
  "weak_spots",
]);

/**
 * Where each old difficulty bucket lands on the 1–20 scale. Mid-bucket rather
 * than edge: the bucket said "roughly here", and pretending it said more than
 * that would silently re-pitch every legacy session's replay.
 */
const LEGACY_YEARS: Record<string, number> = { junior: 2, mid: 6, senior: 12 };

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

  if (c.years_experience === undefined && typeof c.difficulty === "string") {
    c.years_experience = LEGACY_YEARS[c.difficulty] ?? 6;
  }
  delete c.difficulty;

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
  years_experience: z.coerce
    .number()
    .int()
    .min(YEAR_BOUNDS.min)
    .max(YEAR_BOUNDS.max)
    .default(6),
  sources: z.array(interviewSourceSchema).max(3).default([]),
  mode: exclusiveModeSchema.nullable().default(null),
  topic: z.string().trim().max(2_000).optional(),
  job_description: z.string().trim().max(20_000).optional(),
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
});

/** Reads a config off a session row, whatever shape it was written in. */
export const storedConfigSchema = z.preprocess(migrateConfig, interviewConfigSchema);

export const startRequestSchema = z
  .object({
    // The résumé, always. Sources choose what to ask on top of it.
    source_text: z.string().min(1).max(20_000),
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
  });

// ── Starred questions ─────────────────────────────────────────────

export const starSchema = z.object({ turn_id: z.string().uuid() });
/** sha256, lowercase hex — the shape repo.questionHash produces. */
export const unstarSchema = z.object({ question_hash: z.string().regex(/^[a-f0-9]{64}$/) });

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
});

export type QuestionResponse = z.infer<typeof questionResponseSchema>;
export type ReportResponse = z.infer<typeof reportResponseSchema>;
