export type SourceType = "resume" | "jd" | "topic";

export type Difficulty = "easy" | "medium" | "hard" | "extreme";

export type InterviewType = "technical" | "cultural" | "mixed";

export type QuestionType = "technical" | "cultural" | "followup" | "behavioral";

export type InterviewSource =
  | "resume"
  | "topic"
  | "cultural";

export type ExclusiveMode =
  | "topic_only"
  | "cultural_only"
  | "jd"
  | "real"
  | "weak_spots"
  | "starred"
  | "project";

export type InterviewMode = "resume" | "topic" | ExclusiveMode;

export type InterviewStage =
  | "intro"
  | "intro_followup"
  | "resume"
  | "concepts"
  | "depth"
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
  num_questions: number;
  difficulty: Difficulty;
  persona?: Persona;
  sources: InterviewSource[];
  mode: ExclusiveMode | null;
  topic?: string;
  job_description?: string;
  job_url?: string;
  company?: string;
  job_title?: string;
  job_location?: string;
  project_context?: string;
  project_repo_url?: string;
  starred_hashes?: string[];
  allow_repeats: boolean;
  max_answer_seconds?: number;
}

export interface AnswerScores {
  relevance: number;
  correctness: number;
  structure: number;
  depth: number;
  filler: number;
}

export interface StartRequest {
  source_text: string;
  source_type?: SourceType;
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

export interface TurnState {
  turn_index: number;
  question: string;
  question_type: QuestionType;
  transcript: string | null;
  has_audio: boolean;
}

export interface SessionStateResponse {
  session_id: string;
  status: SessionStatus;
  role: string | null;
  config: InterviewConfig;
  turns: TurnState[];
  current_turn_index: number | null;
  num_questions: number;
}

export interface EndResponse {
  session_id: string;
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

export interface VoiceResponse {
  url: string | null;
  provider: "orpheus" | "browser";
  cached?: boolean;
  reason?: string;
  budget_remaining?: number;
}

export interface AwaySegment {
  start_ms: number;
  end_ms: number;
}

export interface CameraTurnMetrics {
  frames: number;
  no_face_frames: number;
  on_camera_pct: number;
  smile_pct: number;
  head_motion_dps: number;
  away_segments: AwaySegment[];
  longest_away_ms: number;
  sample_hz: number;
  pose_source: "matrix" | "landmarks";
}

export interface DeliveryMetrics {
  wpm: number;
  avg_pause_ms: number;
  filler_count: number;
  pitch_variation: number | null;
  energy: number | null;
  mean_pitch_hz: number | null;
  jitter_local: number | null;
  shimmer_local: number | null;
  hnr_db: number | null;
  uptalk_pct: number | null;
  uptalk_statements: number;
  uptalk_rising: number;
  on_camera_pct: number | null;
  smile_pct: number | null;
  head_motion_dps: number | null;
  camera_turns: number;
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

export interface QuestionFeedback {
  turn_index: number;
  possible_answers: string[];
  improvements: string[];
}

export type StarLabel = "S" | "T" | "A" | "R" | "other";

export interface StarSegment {
  label: StarLabel;
  start: number;
  end: number;
  text: string;
}

export interface StarBreakdown {
  turn_index: number;
  basis: "time" | "words";
  segments: StarSegment[];
  share: Record<StarLabel, number>;
  missing: Exclude<StarLabel, "other">[];
  note: string;
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
  star_breakdown: StarBreakdown[];
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

export interface ApiError {
  error: { code: string; message: string };
}

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface DashboardStats {
  completed: number;
  last_score: number | null;
  trend: number[];
  first_score: number | null;
  sessions_this_week: number;
  fillers_per_answer: number | null;
  fillers_per_answer_first: number | null;
  top_pattern: string | null;
  streak_days: number;
  cards_due: number;
}

export interface RecentSession {
  session_id: string;
  date: string;
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

export interface AcousticMetrics {
  pitch_variation: number;
  energy: number;
  mean_pitch_hz: number;
  jitter_local: number | null;
  shimmer_local: number | null;
  hnr_db: number | null;
  uptalk_statements: number | null;
  uptalk_rising: number | null;
}

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

export type QuestionSetSource = "resume" | "topic" | "cultural";

export interface GenerateQuestionSetRequest {
  name: string;
  source: QuestionSetSource;
  source_text?: string;
  role?: string;
  difficulty: Difficulty;
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
  count: number;
  created_at: string;
  times_practised: number;
}

export interface QuestionSetDetail extends QuestionSetSummary {
  items: QuestionSetItemDTO[];
}

export interface QuestionSetListResponse {
  sets: QuestionSetSummary[];
}

export interface GenerateQuestionSetResponse {
  set: QuestionSetDetail;
}

export interface DeleteQuestionSetResponse {
  set_id: string;
  deleted: true;
}

export type JobImportSource = "greenhouse" | "lever" | "ashby" | "generic" | "bookmarklet";

export interface JobImportResponse {
  title: string;
  company: string | null;
  location: string | null;
  description: string;
  source: JobImportSource;
  url: string;
}

export type DrillGrade = 1 | 3 | 5;

export interface DrillCardDTO {
  id: string;
  question: string;
  question_type: QuestionType;
  due_at: string;
  interval_days: number;
  repetitions: number;
  last_grade: number | null;
  best_transcript: string | null;
  best_mean: number | null;
  ahead: boolean;
}

export interface DrillQueueResponse {
  cards: DrillCardDTO[];
  due_total: number;
  streak_days: number;
  reviewed_today: number;
}

export interface DrillAnswerResponse {
  card_id: string;
  transcript: string;
  answer_scores: AnswerScores;
  suggested_grade: DrillGrade;
  improvements: string[];
  better_line: string | null;
  previous_best: string | null;
}

export interface DrillReviewResponse {
  due_at: string;
  interval_days: number;
  streak_days: number;
}

export type DiffOp = { op: "keep" | "add" | "del"; text: string };

export interface MetricDelta {
  key: string;
  label: string;
  then: number | null;
  now: number | null;
  delta: number | null;
  unit: string;
  better: "up" | "down" | "none";
}

export interface TurnComparison {
  turn_index: number;
  question: string;
  then_transcript: string;
  now_transcript: string;
  then_mean: number | null;
  now_mean: number | null;
  diff: DiffOp[];
}

export interface Comparison {
  parent_session_id: string;
  parent_name: string | null;
  parent_date: string;
  overall: MetricDelta;
  categories: MetricDelta[];
  delivery: MetricDelta[];
  turns: TurnComparison[];
}

export interface CompanyNewsItem {
  headline: string;
  date: string;
  why_it_matters: string;
}

export interface CompanyBrief {
  what_they_do: string;
  recent_news: CompanyNewsItem[];
  values: string[];
  interview_style_notes: string[];
  likely_questions: string[];
  questions_to_ask: string[];
}

export interface GroundingSource {
  uri: string;
  title: string;
}

export interface CompanyBriefResponse {
  brief: CompanyBrief;
  grounded: boolean;
  sources: GroundingSource[];
  cached: boolean;
  generated_at: string;
}
