// Shared API contract types (web <-> api). Runtime-free — pure types.
// The API validates with Zod (apps/api/src/schemas.ts); these mirror the
// validated shapes so the frontend gets end-to-end type safety.

export type SourceType = "resume" | "jd" | "topic";

/**
 * Legacy. Level is years of experience now (1–20), which says the same thing
 * with more resolution and without making the user translate their career into
 * three buckets. Sessions recorded before the change still carry `difficulty`,
 * so it's read on the way in and mapped to years; never write it.
 */
export type Difficulty = "junior" | "mid" | "senior";

/**
 * Legacy. "Focus" was a third axis that only ever restated what the sources
 * already say — picking `cultural` as a focus and `cultural` as a source were
 * the same request. The sources carry it now; never write it.
 */
export type InterviewType = "technical" | "cultural" | "mixed";

/**
 * `behavioral` is legacy: it and `cultural` always meant the same thing, so
 * only `cultural` is generated now. The value stays in the union (and in the DB
 * enum) because turns recorded before the change still carry it — dropping it
 * would orphan them. Read it as "cultural"; never write it.
 */
export type QuestionType = "technical" | "cultural" | "followup" | "behavioral";

/**
 * What an interview draws its questions from. These combine freely: résumé +
 * topic + cultural is one blended interview that moves between all three, not
 * three interviews stapled together. A real interview mixes material like this,
 * so the picker does too.
 */
export type InterviewSource =
  /** Their own history — what they built, and what they'd rather skip. */
  | "resume"
  /** A subject they name, still tied back to work they've actually done. */
  | "topic"
  /** How they work with people: conflict, failure, judgement calls. */
  | "cultural";

/**
 * Interviews that define their own shape, and so can't be blended with anything.
 * Each one either ignores the résumé, follows a fixed arc, or picks its
 * questions from history — none of which survives being mixed.
 */
export type ExclusiveMode =
  /** A subject they name, résumé deliberately ignored. */
  | "topic_only"
  /** A real posting they're going for, probed against their résumé. */
  | "jd"
  /** The full arc, opening to close. See `InterviewStage`. */
  | "real"
  /** Re-asks the questions they scored worst on, mixed with new ones. */
  | "weak_spots";

/**
 * Legacy union: the single mode that `sources` + `ExclusiveMode` replaced.
 * Old sessions store one of these; `toSessionContext` maps them forward.
 */
export type InterviewMode = "resume" | "topic" | ExclusiveMode;

/**
 * The ordered arc of a `real` interview — the shape every human interviewer
 * actually runs, rather than a flat pile of questions.
 */
export type InterviewStage =
  /** "Tell me about yourself." */
  | "intro"
  /** Pulls a thread out of whatever they just said. */
  | "intro_followup"
  /** Their actual history. */
  | "resume"
  /** Fundamentals, pitched at their years of experience. */
  | "concepts"
  /** Where it gets hard: trade-offs, failure, judgement. */
  | "depth"
  /** "Do you have any questions for us?" — every interview ends here. */
  | "closing";
export type SessionStatus =
  | "in_progress"
  | "generating_report"
  | "completed"
  | "cancelled"
  | "abandoned"
  | "error";

export interface InterviewConfig {
  /** Required, and the user's own words: this is how they find it again. */
  name: string;
  /** Bounded by `QUESTION_BOUNDS` in apps/web/lib/schemas.ts. */
  num_questions: number;
  /**
   * Years of experience, bounded by `YEAR_BOUNDS` in apps/web/lib/schemas.ts.
   * Drives how hard the questions are pitched. Replaces junior/mid/senior.
   */
  years_experience: number;
  /**
   * What to draw questions from, blended. Non-empty exactly when `mode` is null
   * — an exclusive mode brings its own material, so the two are never both set.
   */
  sources: InterviewSource[];
  /** An interview with its own fixed shape, or null when `sources` drives it. */
  mode: ExclusiveMode | null;
  /** The `topic` source, or `topic_only` mode: the subject to drill. */
  topic?: string;
  /** `jd`: the posting being targeted. */
  job_description?: string;
  /**
   * Off by default. When off, every question this user has already been asked
   * is handed to the model as a do-not-reuse list — this is a repeat-practice
   * tool, so the same résumé must not produce the same interview twice.
   */
  allow_repeats: boolean;
}

/** Per-answer rubric — BACKEND_README §10. */
export interface AnswerScores {
  relevance: number;
  correctness: number;
  structure: number;
  depth: number;
  filler: number;
}

export interface StartRequest {
  /** The résumé text (extracted client-side via /resume/extract). Required. */
  source_text: string;
  source_type?: SourceType;
  role?: string;
  config: Partial<InterviewConfig>;
}

export interface StartResponse {
  session_id: string;
  turn_index: number;
  question: string;
  question_type: QuestionType;
}

export interface AnswerResponse {
  turn_index: number;
  transcript: string;
  answer_scores: AnswerScores;
  next_question: string | null;
  next_question_type: QuestionType | null;
  done: boolean;
}

/** One question/answer slot, as returned by SessionStateResponse. */
export interface TurnState {
  turn_index: number;
  question: string;
  question_type: QuestionType;
  transcript: string | null;
  has_audio: boolean;
}

/**
 * A session's current state, so /session can be resumed after a reload —
 * StartResponse only ever returns the first question.
 */
export interface SessionStateResponse {
  session_id: string;
  status: SessionStatus;
  role: string | null;
  config: InterviewConfig;
  turns: TurnState[];
  /** Index of the first unanswered turn, or null when every question is done. */
  current_turn_index: number | null;
  num_questions: number;
}

export interface EndResponse {
  session_id: string;
  report_id: string;
  status: SessionStatus;
}

export interface CancelResponse {
  session_id: string;
  status: SessionStatus;
}

export interface PresignResponse {
  url: string;
  expires_in: number;
}

export interface DeliveryMetrics {
  wpm: number;
  avg_pause_ms: number;
  filler_count: number;
  pitch_variation: number | null;
  energy: number | null;
  mean_pitch_hz: number | null;
}

export interface CategoryScores {
  technical: number;
  communication: number;
  problem_solving: number;
}

export interface StrengthPoint {
  point: string;
  example: string;
}
export interface WeaknessPoint {
  point: string;
  example: string;
  fix: string;
}
export interface AnswerHighlight {
  turn_index: number;
  quote: string;
  why: string;
}

export interface Report {
  id: string;
  session_id: string;
  overall_score: number;
  verdict: string;
  category_scores: CategoryScores;
  delivery_metrics: DeliveryMetrics;
  strengths: StrengthPoint[];
  weaknesses: WeaknessPoint[];
  best_answer: AnswerHighlight | null;
  worst_answer: AnswerHighlight | null;
  next_steps: string[];
  created_at: string;
}

export interface ProgressEntry {
  session_id: string;
  date: string;
  overall_score: number;
}

/** Uniform API error shape. */
export interface ApiError {
  error: { code: string; message: string };
}

// ── Accounts ──────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string | null;
}

// ── Dashboard ─────────────────────────────────────────────────────
export interface DashboardStats {
  completed: number;
  avg_score: number | null;
  best_score: number | null;
  last_score: number | null;
  trend: number[];
}

export interface RecentSession {
  session_id: string;
  date: string;
  role: string | null;
  score: number | null;
  status: SessionStatus;
}

export interface DashboardData {
  user: User;
  stats: DashboardStats;
  recent: RecentSession[];
}

/** Result of the Python acoustic service (apps/audio). */
export interface AcousticMetrics {
  pitch_variation: number;
  energy: number;
  mean_pitch_hz: number;
}

/** A word with timestamps, from Whisper verbose output. Powers pace/pauses. */
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}
