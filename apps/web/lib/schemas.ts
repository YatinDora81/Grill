import { z } from "zod";
import type { Difficulty, InterviewSource, TurnPayload } from "@repo/types";
import { QUESTION_BOUNDS, QUESTION_SET_BOUNDS } from "./interviewMeta";
import { MAX_ANSWER_OFFSET_MS } from "./live/turnTaking";
import { config } from "./env";

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
  token: z
    .string()
    .trim()
    .min(32)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/),
  password: z.string().min(config.auth.passwordMinLength).max(200),
});

function isKnownTimeZone(zone: string): boolean {
  try {
    Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isKnownTimeZone, "That isn't a time zone this server knows.");

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).nullable().optional(),
  email_on_report: z.boolean().optional(),
  timezone: timezoneSchema.nullable().optional(),
  email_digest: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(config.auth.passwordMinLength).max(200),
});

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

export const roundSchema = z.enum(["spoken", "coding", "design"]);

export const interviewModeSchema = z.enum([
  "resume",
  "topic",
  "topic_only",
  "cultural_only",
  "jd",
  "real",
  "weak_spots",
]);

const LEGACY_DIFFICULTY: Record<string, Difficulty> = {
  junior: "easy",
  mid: "medium",
  senior: "hard",
  easy: "easy",
  medium: "medium",
  hard: "hard",
  extreme: "extreme",
};

function yearsToDifficulty(years: number): Difficulty {
  if (years <= 2) return "easy";
  if (years <= 6) return "medium";
  if (years <= 12) return "hard";
  return "extreme";
}

const LEGACY_SOURCES: Record<string, InterviewSource[]> = {
  resume: ["resume"],
  topic: ["resume", "topic"],
};

function migrateConfig(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const c = { ...(raw as Record<string, unknown>) };

  if (c.sources === undefined && typeof c.mode === "string") {
    const legacy = LEGACY_SOURCES[c.mode];
    if (legacy) {
      c.sources = [...legacy];
      c.mode = null;
    }
  }
  if (c.sources === undefined) c.sources = c.mode ? [] : ["resume"];

  if (c.interview_type === "cultural" || c.interview_type === "behavioral") {
    const s = c.sources as InterviewSource[];
    if (Array.isArray(s) && s.length > 0 && !s.includes("cultural")) s.push("cultural");
  }
  delete c.interview_type;

  const rawDiff = typeof c.difficulty === "string" ? c.difficulty : undefined;
  const modern =
    rawDiff === "easy" || rawDiff === "medium" || rawDiff === "hard" || rawDiff === "extreme";
  if (!modern) {
    if (typeof c.years_experience === "number") {
      c.difficulty = yearsToDifficulty(c.years_experience);
    } else if (rawDiff && LEGACY_DIFFICULTY[rawDiff]) {
      c.difficulty = LEGACY_DIFFICULTY[rawDiff];
    } else {
      c.difficulty = "medium";
    }
  }
  delete c.years_experience;

  return c;
}

export const JOB_DESCRIPTION_MAX_CHARS = 20_000;
export const JOB_DESCRIPTION_MIN_CHARS = 200;
export const JOB_PAGE_TEXT_MAX_CHARS = 60_000;
export const JOB_URL_MAX_CHARS = 2_000;
export const COMPANY_MAX_CHARS = 120;

const optionalText = (max: number) =>
  z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.string().trim().max(max).optional(),
  );

function isHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

export const httpsUrlSchema = (max: number) =>
  z.string().trim().url().max(max).refine(isHttpsUrl, "Links must start with https://.");

const interviewConfigShape = z.object({
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
  job_description: z.string().trim().max(JOB_DESCRIPTION_MAX_CHARS).optional(),
  job_url: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    httpsUrlSchema(JOB_URL_MAX_CHARS).optional(),
  ),
  company: optionalText(COMPANY_MAX_CHARS),
  job_title: optionalText(200),
  job_location: optionalText(200),
  project_context: z.string().trim().max(24_000).optional(),
  project_repo_url: z.string().trim().url().max(500).optional(),
  starred_hashes: z
    .array(z.string().regex(/^[0-9a-f]{64}$/))
    .min(1)
    .max(12)
    .optional(),
  allow_repeats: z.coerce.boolean().default(false),
  max_answer_seconds: z.coerce.number().int().positive().optional(),
  round: roundSchema.default("spoken"),
  problems: z.coerce.number().int().min(1).max(3).default(2),
  live: z.coerce.boolean().default(false),
});

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
  if (v.round !== "spoken" && (v.mode === "starred" || v.mode === "weak_spots")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["round"],
      message:
        "Coding and design rounds draw on your résumé, a topic or a job description — not saved questions.",
    });
  }
  if (v.live && v.round !== "spoken") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["live"],
      message: "Live mode is for spoken interviews.",
    });
  }
});

export const storedConfigSchema = z.preprocess(migrateConfig, interviewConfigSchema);

export const startRequestSchema = z
  .object({
    source_text: z.string().max(20_000).default(""),
    source_type: z.enum(["resume", "jd", "topic"]).default("resume"),
    name: z.string().trim().min(1, "Give this interview a name.").max(80),
    role: z.string().max(200).optional(),
    config: interviewConfigSchema,
  })
  .superRefine((v, ctx) => {
    if (
      v.config.round === "spoken" &&
      v.config.mode !== "starred" &&
      v.config.num_questions < QUESTION_BOUNDS.min
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config", "num_questions"],
        message: `An interview needs at least ${QUESTION_BOUNDS.min} questions.`,
      });
    }
    if (v.config.mode !== "project" && !v.source_text.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_text"],
        message: "A résumé is required for this interview.",
      });
    }
  });

export const starSchema = z.object({ turn_id: z.string().uuid() });
export const unstarSchema = z.object({ question_hash: z.string().regex(/^[a-f0-9]{64}$/) });

export const questionSetSourceSchema = z.enum(["resume", "topic", "cultural"]);

const SET_TOPIC_MAX_CHARS = 2_000;

export const createQuestionSetSchema = z
  .object({
    name: z.string().trim().min(1, "Give this set a name.").max(80),
    source: questionSetSourceSchema,
    source_text: z.string().max(20_000).default(""),
    role: z.string().trim().max(200).optional(),
    difficulty: difficultySchema,
    count: z.coerce.number().int().min(QUESTION_SET_BOUNDS.min).max(QUESTION_SET_BOUNDS.max),
  })
  .superRefine((v, ctx) => {
    if (v.source === "resume" && !v.source_text.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_text"],
        message: "A résumé is required for a résumé set.",
      });
    }
    if (v.source === "topic") {
      const topic = v.source_text.trim();
      if (!topic) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source_text"],
          message: "Name the topic to generate questions on.",
        });
      } else if (topic.length > SET_TOPIC_MAX_CHARS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source_text"],
          message: `A topic is a subject line, not a document — keep it under ${SET_TOPIC_MAX_CHARS} characters.`,
        });
      }
    }
  });

export const setIdParamsSchema = z.object({ setId: z.string().uuid() });

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

const AWAY_MS_MAX = 12 * 3_600_000;

export const awaySegmentSchema = z
  .object({
    start_ms: z.coerce.number().int().min(0).max(AWAY_MS_MAX),
    end_ms: z.coerce.number().int().min(0).max(AWAY_MS_MAX),
  })
  .superRefine((v, ctx) => {
    if (v.end_ms < v.start_ms) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_ms"],
        message: "A look-away cannot end before it starts.",
      });
    }
  });

export const postureMetricsSchema = z.object({
  frames: z.coerce.number().int().min(0).max(100_000),
  slouch_pct: z.coerce.number().min(0).max(100),
  hands_to_face_pct: z.coerce.number().min(0).max(100),
  shoulder_tilt_deg: z.coerce.number().min(0).max(90),
  wrist_motion: z.coerce.number().min(0).max(1_000),
  sample_hz: z.coerce.number().min(1).max(60),
});

export const cameraMetricsSchema = z.object({
  frames: z.coerce.number().int().min(0).max(100_000),
  no_face_frames: z.coerce.number().int().min(0).max(100_000),
  on_camera_pct: z.coerce.number().min(0).max(100),
  smile_pct: z.coerce.number().min(0).max(100),
  head_motion_dps: z.coerce.number().min(0).max(10_000),
  away_segments: z.array(awaySegmentSchema).max(500),
  longest_away_ms: z.coerce.number().int().min(0).max(AWAY_MS_MAX),
  sample_hz: z.coerce.number().min(1).max(60),
  pose_source: z.enum(["matrix", "landmarks"]),
  posture: postureMetricsSchema.nullish(),
});

const INVALID_JSON = "__invalid_json__";

function jsonField<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => {
    if (v === null || v === undefined || v === "") return undefined;
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return INVALID_JSON;
    }
  }, schema.optional());
}

export const videoStartSchema = z.object({
  session_id: z.string().uuid(),
  mime_type: z.string().min(1).max(100),
});

export const videoRefSchema = z.object({ video_id: z.string().uuid() });

export const videoPartUrlSchema = z.object({
  video_id: z.string().uuid(),
  part_number: z.coerce.number().int().min(1).max(config.video.maxParts),
});

export const answerVideoFields = {
  video_id: z.string().uuid().optional(),
  video_offset_ms: z.coerce.number().int().min(0).optional(),
};

export const answerTextSchema = z.object({
  session_id: z.string().uuid(),
  turn_index: z.coerce.number().int().min(0),
  text: z.string().min(1).max(20_000),
  ...answerVideoFields,
  camera_metrics: cameraMetricsSchema.nullish(),
});

export const turnRefSchema = z.object({
  session_id: z.string().uuid(),
  turn_index: z.coerce.number().int().min(0),
  video_id: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.string().uuid().optional(),
  ),
  video_offset_ms: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.coerce.number().int().min(0).optional(),
  ),
  camera_metrics: jsonField(cameraMetricsSchema),
  answer_offset_ms: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.coerce.number().int().min(0).max(MAX_ANSWER_OFFSET_MS).optional(),
  ),
  interrupted_at_s: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.coerce.number().int().min(0).max(3_600).optional(),
  ),
});

export const sessionIdSchema = z.object({ session_id: z.string().uuid() });

export const LIVE_TURNS_MAX = 40;
export const LIVE_QUESTION_MAX_CHARS = 2_000;
export const LIVE_ANSWER_MAX_CHARS = 20_000;

export const liveTurnSchema = z.object({
  question: z.string().trim().min(1).max(LIVE_QUESTION_MAX_CHARS),
  answer: z.string().trim().max(LIVE_ANSWER_MAX_CHARS),
});

export const liveCompleteSchema = z.object({
  session_id: z.string().uuid(),
  turns: z.array(liveTurnSchema).max(LIVE_TURNS_MAX),
});

export const voiceRequestSchema = z.object({
  session_id: z.string().uuid(),
  turn_index: z.coerce.number().int().min(0),
});

export const shareSessionParamsSchema = z.object({ sessionId: z.string().uuid() });

export const shareTokenSchema = z
  .string()
  .trim()
  .min(32)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);

export const jdExtractRequestSchema = z.object({
  url: httpsUrlSchema(JOB_URL_MAX_CHARS),
  page_title: optionalText(300),
  page_text: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.string().trim().min(1).max(JOB_PAGE_TEXT_MAX_CHARS).optional(),
  ),
});

export const companyBriefRequestSchema = z.object({
  company: z
    .string()
    .trim()
    .min(1, "Name the company you're interviewing at.")
    .max(COMPANY_MAX_CHARS),
  role: optionalText(COMPANY_MAX_CHARS),
  refresh: z.coerce.boolean().default(false),
});

const cappedLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.slice(0, max));

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

const codingExampleSchema = z.object({
  input: z.string().max(4_000),
  output: z.string().max(4_000),
  explanation: z.string().max(600).optional(),
});

export const codingQuestionSchema = z
  .object({
    title: cappedLine(120),
    prompt_markdown: z.string().trim().min(40).max(6_000),
    examples: z.array(codingExampleSchema).min(1).max(3),
    hidden_tests: z.array(codingExampleSchema).min(2).max(6),
    starter: z.object({
      python: z.string().max(4_000).catch(""),
      javascript: z.string().max(4_000).catch(""),
    }),
    complexity_target: cappedLine(120).catch(""),
  })
  .transform((v) => ({ kind: "coding" as const, ...v }));

export const designQuestionSchema = z
  .object({
    title: cappedLine(120),
    prompt_markdown: z.string().trim().min(40).max(6_000),
    requirements: keepingOnlyWellFormed(cappedLine(240), 8),
    scale: cappedLine(240).catch(""),
    focus: keepingOnlyWellFormed(cappedLine(120), 5),
  })
  .transform((v) => ({ kind: "design" as const, ...v }));

export const turnPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coding") }).passthrough(),
  z.object({ kind: z.literal("design") }).passthrough(),
]);

export function readTurnPayload(raw: unknown): TurnPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = (raw as { kind?: unknown }).kind;
  if (kind === "coding") {
    const r = codingQuestionSchema.safeParse(raw);
    return r.success ? r.data : null;
  }
  if (kind === "design") {
    const r = designQuestionSchema.safeParse(raw);
    return r.success ? r.data : null;
  }
  return null;
}

export const codeLanguageSchema = z.enum(["python", "javascript"]);

const runResultSchema = z.object({
  index: z.coerce.number().int().min(0),
  kind: z.enum(["example", "hidden"]),
  passed: z.boolean(),
  stdout: z.string().max(20_000),
  stderr: z.string().max(20_000),
  expected: z.string().max(20_000),
  time_ms: z.coerce.number().min(0),
  timed_out: z.boolean(),
});

const keystrokeStatsSchema = z.object({
  first_edit_ms: z.coerce.number().min(0).nullable(),
  edits: z.coerce.number().int().min(0),
  chars_added: z.coerce.number().int().min(0),
  chars_deleted: z.coerce.number().int().min(0),
  longest_idle_ms: z.coerce.number().min(0),
  runs: z.coerce.number().int().min(0),
  run_timeline: z
    .array(
      z.object({
        t_ms: z.coerce.number().min(0),
        passed: z.coerce.number().int().min(0),
        total: z.coerce.number().int().min(0),
      }),
    )
    .max(200),
  submitted_at_ms: z.coerce.number().min(0),
});

export const codeAnswerPayloadSchema = z.object({
  language: codeLanguageSchema,
  source: z.string().max(60_000),
  results: z.array(runResultSchema).max(12),
  keystrokes: keystrokeStatsSchema,
});

export const storedCodeSubmissionSchema = z.object({
  language: codeLanguageSchema,
  source: z.string().catch(""),
  results: keepingOnlyWellFormed(runResultSchema, 12),
  passed: z.coerce.number().int().min(0).catch(0),
  total: z.coerce.number().int().min(0).catch(0),
  keystrokes: keystrokeStatsSchema,
  think_aloud_pct: z.number().nullable().catch(null),
  longest_silence_s: z.number().nullable().catch(null),
});

export const codingTestsQuerySchema = z.object({
  session_id: z.string().uuid(),
  turn_index: z.coerce.number().int().min(0),
});

export type CodeAnswerPayload = z.infer<typeof codeAnswerPayloadSchema>;

const DESIGN_LIST_MAX_ITEMS = 12;

export const designActivitySchema = z.object({
  first_edit_ms: z.coerce.number().min(0).nullable().catch(null),
  longest_idle_ms: z.coerce.number().min(0).catch(0),
  final_elements: z.coerce.number().int().min(0).catch(0),
});

export const storedDesignReviewSchema = z.object({
  summary: cappedLine(600).catch(""),
  components: keepingOnlyWellFormed(cappedLine(240), DESIGN_LIST_MAX_ITEMS),
  missing: keepingOnlyWellFormed(cappedLine(240), DESIGN_LIST_MAX_ITEMS),
  single_points_of_failure: keepingOnlyWellFormed(cappedLine(240), DESIGN_LIST_MAX_ITEMS),
  scale_concerns: keepingOnlyWellFormed(cappedLine(240), DESIGN_LIST_MAX_ITEMS),
  follow_up_question: cappedLine(400).catch(""),
  activity: designActivitySchema.nullable().catch(null),
});

export const questionResponseSchema = z.object({
  question: z.string().min(1),
  question_type: z
    .enum(["technical", "cultural", "followup", "behavioral"])
    .transform((v) => (v === "behavioral" ? "cultural" : v)),
});

const batchQuestionSchema = z.object({
  question: z.string().trim().min(1),
  question_type: z
    .enum(["technical", "cultural", "followup", "behavioral"])
    .transform((v) => (v === "behavioral" ? "cultural" : v === "followup" ? "technical" : v)),
});

export const questionBatchResponseSchema = z.object({
  questions: z
    .array(z.unknown())
    .min(1)
    .transform((raw) =>
      raw.flatMap((v) => {
        const parsed = batchQuestionSchema.safeParse(v);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

export type BatchQuestion = z.infer<typeof batchQuestionSchema>;

export const answerScoresSchema = z.object({
  relevance: z.coerce.number().min(0).max(10),
  correctness: z.coerce.number().min(0).max(10),
  structure: z.coerce.number().min(0).max(10),
  depth: z.coerce.number().min(0).max(10),
  filler: z.coerce.number().min(0).max(10),
});

export const designReviewResponseSchema = z.object({
  summary: cappedLine(600),
  components: keepingOnlyWellFormed(cappedLine(240), DESIGN_LIST_MAX_ITEMS),
  missing: keepingOnlyWellFormed(cappedLine(240), DESIGN_LIST_MAX_ITEMS),
  single_points_of_failure: keepingOnlyWellFormed(cappedLine(240), DESIGN_LIST_MAX_ITEMS),
  scale_concerns: keepingOnlyWellFormed(cappedLine(240), DESIGN_LIST_MAX_ITEMS),
  follow_up_question: cappedLine(400),
  scores: answerScoresSchema,
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

const coveredItemSchema = z.object({
  requirement: cappedLine(240),
  evidence: cappedLine(GAP_LINE_MAX_CHARS),
});

const gapItemSchema = z.object({
  requirement: cappedLine(240),
  why_it_matters: cappedLine(GAP_LINE_MAX_CHARS),
  how_to_close: cappedLine(GAP_LINE_MAX_CHARS),
});

export const resumeGapResponseSchema = z.object({
  match_percent: z.coerce.number().transform((n) => Math.min(100, Math.max(0, Math.round(n)))),
  summary: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.slice(0, GAP_SUMMARY_MAX_CHARS)),
  covered: keepingOnlyWellFormed(coveredItemSchema, GAP_LIST_MAX_ITEMS),
  gaps: keepingOnlyWellFormed(gapItemSchema, GAP_LIST_MAX_ITEMS),
});

export const starLabelSchema = z.enum(["S", "T", "A", "R", "other"]);

export const starPartSchema = z.enum(["S", "T", "A", "R"]);

const STAR_LABELS_MAX = 400;
const STAR_NOTE_MAX_CHARS = 300;

export const starResponseSchema = z.object({
  labels: z.array(starLabelSchema).min(1).max(STAR_LABELS_MAX),
  missing: z.array(starPartSchema).default([]).catch([]),
  note: cappedLine(STAR_NOTE_MAX_CHARS),
});

export const jobExtractSchema = z.object({
  title: z
    .string()
    .trim()
    .transform((t) => t.slice(0, 200))
    .catch(""),
  company: optionalText(COMPANY_MAX_CHARS).transform((v) => v ?? null),
  location: optionalText(200).transform((v) => v ?? null),
  description: z
    .string()
    .trim()
    .transform((s) => s.slice(0, JOB_DESCRIPTION_MAX_CHARS))
    .catch(""),
});

const BRIEF_LIST_MAX_ITEMS = 8;
const BRIEF_SUMMARY_MAX_CHARS = 600;

const briefNewsSchema = z.object({
  headline: cappedLine(160),
  date: cappedLine(40).catch(""),
  why_it_matters: cappedLine(400),
});

export const companyBriefSchema = z.object({
  what_they_do: z
    .string()
    .trim()
    .transform((s) => s.slice(0, BRIEF_SUMMARY_MAX_CHARS))
    .catch(""),
  recent_news: keepingOnlyWellFormed(briefNewsSchema, BRIEF_LIST_MAX_ITEMS),
  values: keepingOnlyWellFormed(cappedLine(200), BRIEF_LIST_MAX_ITEMS),
  interview_style_notes: keepingOnlyWellFormed(cappedLine(300), BRIEF_LIST_MAX_ITEMS),
  likely_questions: keepingOnlyWellFormed(cappedLine(300), BRIEF_LIST_MAX_ITEMS),
  questions_to_ask: keepingOnlyWellFormed(cappedLine(300), BRIEF_LIST_MAX_ITEMS),
});

export const briefSourceSchema = z.object({
  uri: httpsUrlSchema(2_000),
  title: z
    .string()
    .trim()
    .transform((t) => t.slice(0, 300))
    .catch(""),
});

export const briefSourcesSchema = keepingOnlyWellFormed(briefSourceSchema, 20);

const DRILL_TEXT_MAX_CHARS = 20_000;
const DRILL_LINE_MAX_CHARS = 360;
const DRILL_IMPROVEMENTS_MAX = 2;

export const drillCardRefSchema = z.object({ card_id: z.string().uuid() });

export const drillQueueQuerySchema = z.object({
  limit: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.coerce.number().int().min(1).max(20).optional(),
  ),
});

export const drillAudioAnswerSchema = drillCardRefSchema;

export const drillTextAnswerSchema = drillCardRefSchema.extend({
  text: z.string().trim().min(1).max(DRILL_TEXT_MAX_CHARS),
});

export const drillReviewSchema = drillCardRefSchema.extend({
  grade: z.coerce.number().int().min(0).max(5),
  transcript: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.string().trim().max(DRILL_TEXT_MAX_CHARS).optional(),
  ),
  answer_scores: answerScoresSchema.optional(),
});

export const addDrillCardSchema = z.object({ turn_id: z.string().uuid() });

export const suspendDrillCardSchema = drillCardRefSchema;

export const drillFeedbackSchema = z.object({
  improvements: keepingOnlyWellFormed(cappedLine(DRILL_LINE_MAX_CHARS), DRILL_IMPROVEMENTS_MAX),
  better_line: cappedLine(DRILL_LINE_MAX_CHARS),
});

const storedMetric = z.number().nullable().catch(null);

const storedCount = z.number().catch(0);

export const deliveryMetricsSchema = z.object({
  wpm: storedMetric,
  avg_pause_ms: storedMetric,
  filler_count: storedMetric,
  pitch_variation: storedMetric,
  energy: storedMetric,
  mean_pitch_hz: storedMetric,
  on_camera_pct: storedMetric,
  smile_pct: storedMetric,
  head_motion_dps: storedMetric,
  camera_turns: storedCount,
  jitter_local: storedMetric,
  shimmer_local: storedMetric,
  hnr_db: storedMetric,
  uptalk_pct: storedMetric,
  uptalk_statements: storedCount,
  uptalk_rising: storedCount,
  response_latency_ms: storedMetric,
  interruptions: storedCount,
  articulation_rate_sps: storedMetric,
  speech_rate_sps: storedMetric,
  phonation_ratio: storedMetric,
  trailing_off_pct: storedMetric,
  trailing_off_statements: storedCount,
  trailing_off_fading: storedCount,
  transcriber_confidence: storedMetric,
  slouch_pct: storedMetric,
  hands_to_face_pct: storedMetric,
  shoulder_tilt_deg: storedMetric,
  wrist_motion: storedMetric,
  posture_turns: storedCount,
});

const starSegmentSchema = z.object({
  label: starLabelSchema,
  start: storedCount,
  end: storedCount,
  text: z.string().catch(""),
});

export const starBreakdownSchema = z.object({
  turn_index: z.number().int(),
  basis: z.enum(["time", "words"]),
  segments: z.array(starSegmentSchema).max(STAR_LABELS_MAX).catch([]),
  share: z.object({
    S: storedCount,
    T: storedCount,
    A: storedCount,
    R: storedCount,
    other: storedCount,
  }),
  missing: z.array(starPartSchema).catch([]),
  note: z.string().catch(""),
});

export const starBreakdownsSchema = keepingOnlyWellFormed(starBreakdownSchema, QUESTION_BOUNDS.max);

export type QuestionResponse = z.infer<typeof questionResponseSchema>;
export type ReportResponse = z.infer<typeof reportResponseSchema>;
export type ResumeGapParsed = z.infer<typeof resumeGapResponseSchema>;
export type AwaySegmentInput = z.infer<typeof awaySegmentSchema>;
export type CameraMetricsInput = z.infer<typeof cameraMetricsSchema>;
export type StarResponse = z.infer<typeof starResponseSchema>;
export type JobExtractParsed = z.infer<typeof jobExtractSchema>;
export type CompanyBriefParsed = z.infer<typeof companyBriefSchema>;
export type BriefSource = z.infer<typeof briefSourceSchema>;
export type DrillFeedback = z.infer<typeof drillFeedbackSchema>;
export type DeliveryMetricsParsed = z.infer<typeof deliveryMetricsSchema>;
export type StarBreakdownParsed = z.infer<typeof starBreakdownSchema>;
