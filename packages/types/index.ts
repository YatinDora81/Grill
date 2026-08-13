// Shared API contract types (web <-> api). Runtime-free — pure types.
// The API validates with Zod (apps/api/src/schemas.ts); these mirror the
// validated shapes so the frontend gets end-to-end type safety.

export type SourceType = "resume" | "jd" | "topic";

/**
 * How hard the interview is pitched. The form writes one of these four.
 *
 * Older sessions may still carry `junior` / `mid` / `senior`, or a year count
 * in `years_experience` — both are migrated on read to this union. Never write
 * the legacy values.
 */
export type Difficulty = "easy" | "medium" | "hard" | "extreme";

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
  /** Culture-fit only — people, values, how they work. Résumé ignored. */
  | "cultural_only"
  /** A real posting they're going for, probed against their résumé. */
  | "jd"
  /** The full arc, opening to close. See `InterviewStage`. */
  | "real"
  /** Re-asks the questions they scored worst on, mixed with new ones. */
  | "weak_spots"
  | "starred"
  /**
   * Grilled on a project they built — pasted write-up or an imported GitHub
   * digest. Brings its own material (`project_context`), so the résumé is
   * optional here and background only.
   */
  | "project";

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
  /** Fundamentals, pitched at the stated difficulty. */
  | "concepts"
  /** Where it gets hard: trade-offs, failure, judgement. */
  | "depth"
  /** "Do you have any questions for us?" — every interview ends here. */
  | "closing";

export type Persona = "neutral" | "friendly_screen" | "terse_staff" | "bar_raiser" | "skeptic";

export type SessionStatus =
  | "in_progress"
  | "generating_report"
  | "completed"
  | "cancelled"
  | "abandoned"
  | "error";

export interface InterviewConfig {
  /** Bounded by `QUESTION_BOUNDS` in apps/web/lib/schemas.ts. */
  num_questions: number;
  /**
   * How hard questions are pitched. See `DIFFICULTY_META` in interviewMeta.
   * Replaces the old years-of-experience slider and the junior/mid/senior buckets.
   */
  difficulty: Difficulty;
  persona?: Persona;
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
   * `project`: the material the interviewer reads — a pasted write-up or the
   * edited digest of an imported GitHub repo. This IS the interview; the résumé,
   * if present at all, is only background. Bounded to 24 000 chars by the schema.
   */
  project_context?: string;
  /**
   * `project`: the GitHub URL a digest was imported from, when one was used.
   * Display and prompt garnish only — never re-fetched at interview time.
   */
  project_repo_url?: string;
  starred_hashes?: string[];
  /**
   * Off by default. When off, every question this user has already been asked
   * is handed to the model as a do-not-reuse list — this is a repeat-practice
   * tool, so the same résumé must not produce the same interview twice.
   */
  allow_repeats: boolean;
  /**
   * Per-answer recording cap in seconds, derived from `num_questions` by
   * `perAnswerCapSeconds` at creation and frozen here — never chosen by the
   * user. Stored rather than recomputed so the room enforces the same limit the
   * interview was created with, even if the model's constants are retuned
   * later.
   *
   * Optional: sessions created before this field read as "use the flat default".
   */
  max_answer_seconds?: number;
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
  /**
   * The résumé text (extracted client-side via /resume/extract). Required for
   * every mode EXCEPT `project`, which brings its own material and may run with
   * an empty string here.
   */
  source_text: string;
  source_type?: SourceType;
  /**
   * Required, and the user's own words — this is how they find the interview
   * again among fifty others. A property of the session, not of the config:
   * a retry re-runs the same config under a name of its own.
   */
  name: string;
  role?: string;
  config: InterviewConfig;
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
  /** Null when the report is still queued — the common case now that /end is async. */
  report_id: string | null;
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

/** Per-question coaching attached to the report — possible answers + improvements. */
export interface QuestionFeedback {
  turn_index: number;
  /** Strong example answers for this question (can be several angles). */
  possible_answers: string[];
  /** Concrete things to change or add in the candidate's own answer. */
  improvements: string[];
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
  question_feedback: QuestionFeedback[];
  created_at: string;
}

export interface DeleteSessionResponse {
  session_id: string;
  deleted: true;
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
  last_score: number | null;
  trend: number[];
  /** Oldest scored report — the other end of "you climbed from here to here". */
  first_score: number | null;
  /** Sessions SAT in the last seven days that have since been scored. */
  sessions_this_week: number;
  /**
   * Filler words per answered question in the newest scored session.
   * Null when that report's delivery_metrics is missing or malformed, or when
   * the session has no answered turns to divide by — an em dash beats a guess.
   */
  fillers_per_answer: number | null;
  /** The same figure for the oldest scored session, so the number can say which way it moved. */
  fillers_per_answer_first: number | null;
  /**
   * One sentence naming the weakest rubric dimension across recent answers.
   * Null until there are enough scored sessions to call it a pattern rather
   * than a bad day.
   */
  top_pattern: string | null;
}

export interface RecentSession {
  session_id: string;
  date: string;
  /** Null only for sessions created before interviews were named. */
  name: string | null;
  role: string | null;
  score: number | null;
  status: SessionStatus;
  progress: { answered: number; total: number | null; last_activity: string } | null;
}

export interface DeliveryPoint {
  session_id: string;
  date: string;
  wpm: number | null;
  fillers: number | null;
}

export interface RetryChainHop {
  session_id: string;
  name: string | null;
  overall_score: number;
  date: string;
}

export interface RetryChain {
  name: string | null;
  hops: RetryChainHop[];
}

export interface DashboardData {
  user: User;
  stats: DashboardStats;
  recent: RecentSession[];
  delivery_series: DeliveryPoint[];
  retry_chain: RetryChain | null;
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

export interface ResumeGapResponse {
  match_percent: number;
  summary: string;
  covered: { requirement: string; evidence: string }[];
  gaps: { requirement: string; why_it_matters: string; how_to_close: string }[];
}

// ── Question bank ─────────────────────────────────────────────────
// A generated batch of questions with NO interview attached. Reading a set
// never records anything; the one bridge to the interview world is
// StartFromSet, which copies the set's items into a brand-new session's turns
// (the retry mechanism) — the set itself is never mutated by being drilled.

/**
 * What a set draws from. Mirrors the interview sources on purpose — a set is
 * meant to feel like "the questions an interview WOULD ask", minus the
 * interview — but it is its own union so the two features can drift apart.
 */
export type QuestionSetSource = "resume" | "topic" | "cultural";

export interface GenerateQuestionSetRequest {
  /** Required — how the set is found again among fifty others. */
  name: string;
  source: QuestionSetSource;
  /**
   * The material: résumé text for `resume`, the topic line for `topic`.
   * Ignored (and stored as "") for `cultural`, which brings no material.
   */
  source_text?: string;
  role?: string;
  difficulty: Difficulty;
  /** Bounded by `QUESTION_SET_BOUNDS` in apps/web/lib/interviewMeta.ts. */
  count: number;
}

export interface QuestionSetItemDTO {
  item_index: number;
  question: string;
  question_type: QuestionType;
}

export interface QuestionSetSummary {
  id: string;
  name: string;
  source: QuestionSetSource;
  role: string | null;
  difficulty: Difficulty;
  /** How many items the set actually holds. */
  count: number;
  created_at: string;
  /** Interviews run on this set so far (soft-deleted ones excluded). */
  times_practised: number;
}

export interface QuestionSetDetail extends QuestionSetSummary {
  items: QuestionSetItemDTO[];
}

export interface QuestionSetListResponse {
  sets: QuestionSetSummary[];
}

/** POST /api/questions — the generated set, in full. */
export interface GenerateQuestionSetResponse {
  set: QuestionSetDetail;
}

export interface DeleteQuestionSetResponse {
  set_id: string;
  deleted: true;
}
