import type {
  Difficulty,
  ExclusiveMode,
  InterviewConfig,
  InterviewSource,
  Persona,
} from "@repo/types";

/**
 * How an interview describes itself — to the candidate picking one, and to the
 * model running it.
 *
 * Deliberately not `server-only`: the form paints these labels and the prompts
 * quote them, and the two disagreeing would mean the interview someone chose is
 * not the one the interviewer was briefed with.
 */

/**
 * The bounds the form, the API and the prompt builder all agree on.
 *
 * They live here rather than next to the Zod schemas that enforce them because
 * `schemas.ts` imports `env.ts`, and the form importing them from there pulls
 * server config into the client bundle. Nothing in this file may import `env`.
 */
export const QUESTION_BOUNDS = { min: 3, max: 100 } as const;

/** The four difficulty modes the form offers, in pitch order. */
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard", "extreme"] as const;

/**
 * Per-answer time cap, derived from question count.
 *
 * Two ceilings bound a single answer. The flat one is transcription: an answer
 * is one Groq Whisper call inside PROVIDER_TIMEOUT_MS, so no answer may be long
 * enough to risk it — that's `answerCeilingS`. The other tightens as N grows:
 * the report build must finish inside `buildBudgetS`, and computeDelivery
 * analyzes one clip per question, so every extra question buys less time for
 * each answer.
 *
 * `concurrency` MUST equal the real concurrency of the computeDelivery loop in
 * reportService.ts — that file imports this constant rather than declaring its
 * own for exactly this reason. If the loop were serial this would have to be 1,
 * or the build silently overruns its budget, gets killed, retries
 * MAX_REPORT_ATTEMPTS times and fails the session to `error`.
 *
 * The formula is exact; these constants are NOT measured. See §5 of the spec:
 * llmFixedS, clipFixedS and clipPerSecond are conservative estimates and want
 * benchmarking against a real build before the caps are trusted.
 */
export const ANSWER_CAP_MODEL = {
  /** The `maxDuration` wall for the report build. */
  buildBudgetS: 300,
  /** Two LLM passes (report + delivery), roughly fixed. */
  llmFixedS: 60,
  /** Per-clip fixed cost: R2 round-trip, overhead, cold-ish service start. */
  clipFixedS: 2,
  /** Acoustic analysis seconds per second of audio (~15x realtime). */
  clipPerSecond: 0.15,
  /** ← keep in lockstep with reportService.ts computeDelivery */
  concurrency: 5,
  /** 4-minute product ceiling, also well under the transcription timeout. */
  answerCeilingS: 240,
  /** Below this a question count isn't worth offering. */
  answerFloorS: 60,
} as const;

/**
 * Max seconds allowed for one answer given the question count, or null if this
 * count can't build a report in budget and shouldn't be offered.
 * Rounded down to a clean 0:30.
 */
export function perAnswerCapSeconds(numQuestions: number): number | null {
  const m = ANSWER_CAP_MODEL;
  const k = 1 / m.concurrency;
  const buildTerm =
    ((m.buildBudgetS - m.llmFixedS) / (k * numQuestions) - m.clipFixedS) / m.clipPerSecond;
  const cap = Math.min(m.answerCeilingS, buildTerm);
  if (cap < m.answerFloorS) return null;
  return Math.floor(cap / 30) * 30;
}

/**
 * How hard an interview runs — green → red, easy → extreme.
 *
 * Picking Extreme is not a flattering title; it's a promise the questions will
 * be brutal. Labels here are what the form shows and what the prompt is briefed
 * with, so the two stay in lockstep.
 */
export interface DifficultyMeta {
  label: string;
  /**
   * A CSS colour, read straight into an inline `style` on an element inside the
   * app shell — so it resolves the same tokens everything else does rather than
   * re-typing the verdict scale and drifting from it.
   *
   * `medium` has no token of its own because the scale has no rung between
   * `strong` and `mixed`; it is mixed from the two either side rather than
   * inventing a fifth off-palette colour.
   */
  color: string;
  /** What the candidate is being measured against at this level. */
  blurb: string;
  /** One-line instruction the interviewer prompt quotes. */
  pitch: string;
}

export const DIFFICULTY_META: Record<Difficulty, DifficultyMeta> = {
  easy: {
    label: "Easy",
    color: "var(--color-strong)",
    blurb: "Fundamentals and clear explanations. Warm-up pace.",
    pitch: "Keep questions approachable — core concepts, straightforward scenarios, room to think out loud.",
  },
  medium: {
    label: "Medium",
    color: "color-mix(in srgb, var(--color-strong) 45%, var(--color-mixed))",
    blurb: "You own features end to end and can defend the how.",
    pitch: "Solid working-level depth — real decisions, trade-offs, and concrete examples from practice.",
  },
  hard: {
    label: "Hard",
    color: "var(--color-mixed)",
    blurb: "Trade-offs, failure, and the calls you got wrong.",
    pitch: "Push hard on judgement, failure modes, and ambiguity — answers need sharp reasoning, not slogans.",
  },
  extreme: {
    label: "Extreme",
    color: "var(--color-weak)",
    blurb: "Systems, blast radius, and answering for outcomes under pressure.",
    pitch: "Brutal but fair — staff/principal depth, uncomfortable edge cases, and no soft landings.",
  },
};

export function difficultyLabel(d: Difficulty): string {
  return DIFFICULTY_META[d].label;
}

export interface PersonaMeta {
  label: string;
  tagline: string;
  prompt: string;
}

export const PERSONA_META: Record<Persona, PersonaMeta> = {
  neutral: { label: "Neutral", tagline: "Sharp, fair, no theater.", prompt: "" },
  friendly_screen: {
    label: "Friendly screen",
    tagline: "Warm HR opener energy.",
    prompt:
      "Voice: warm and encouraging, first-round phone-screen register. Soften phrasing, never the substance — probe just as deep.",
  },
  terse_staff: {
    label: "Terse staff eng",
    tagline: "Five words where five suffice.",
    prompt:
      "Voice: minimal, dry, zero pleasantries. Questions are short and surgical. No filler, no praise.",
  },
  bar_raiser: {
    label: "Bar-raiser",
    tagline: "Evidence or it didn't happen.",
    prompt:
      "Voice: structured behavioral rigor. Push for specifics, ownership and measurable outcomes; ask for the data behind every claim.",
  },
  skeptic: {
    label: "The skeptic",
    tagline: "Assumes it broke in prod.",
    prompt:
      "Voice: politely unconvinced. Challenge premises and tradeoffs; ask what failed, what they'd undo, and why the alternative wasn't better. Professional, never insulting.",
  },
};

export const PERSONAS: readonly Persona[] = [
  "neutral",
  "friendly_screen",
  "terse_staff",
  "bar_raiser",
  "skeptic",
] as const;

export const PERSONA_GUARDRAIL =
  "Persona changes tone and phrasing only — question difficulty, topic selection, and follow-up logic are unchanged; remain professional.";

export function personaLabel(p: Persona | null | undefined): string {
  return PERSONA_META[p ?? "neutral"].label;
}

export function personaBrief(p: Persona | null | undefined): string {
  const { prompt } = PERSONA_META[p ?? "neutral"];
  return prompt ? `${prompt}\n${PERSONA_GUARDRAIL}` : "";
}

/** How each source reads in the picker. These combine. */
export const SOURCE_META: Record<InterviewSource, { label: string; blurb: string }> = {
  resume: { label: "Résumé", blurb: "Your own history — what you built, and what you'd rather skip." },
  topic: { label: "Topic", blurb: "A subject you name, tied back to work you've actually done." },
  cultural: {
    label: "Cultural",
    blurb: "How you work with people: conflict, feedback, judgement. Combines with Résumé when both are on.",
  },
};

/** How each exclusive mode reads in the picker. These don't combine. */
export const MODE_META: Record<ExclusiveMode, { label: string; blurb: string }> = {
  jd: {
    label: "Job description",
    blurb: "Interviews you for a real posting, and probes the gaps against your résumé.",
  },
  real: {
    label: "Real interview",
    blurb: "The full arc: introduce yourself, your history, concepts, the hard part, then your questions for us.",
  },
  topic_only: {
    label: "Topic only",
    blurb: "Pure subject examination. Your résumé is ignored entirely.",
  },
  cultural_only: {
    label: "Cultural only",
    blurb: "Culture-fit screen: work style, values, conflict, feedback. Your résumé is ignored.",
  },
  weak_spots: {
    label: "Weak spots",
    blurb: "Re-asks the questions you scored worst on in past interviews, plus new ground.",
  },
  starred: {
    label: "Starred drill",
    blurb: "Your saved killers, asked back in order.",
  },
  project: {
    label: "Project",
    blurb:
      "Defend something you built — architecture, trade-offs, what breaks first. Paste a write-up or import a GitHub repo.",
  },
};

/** One-line description of what an interview actually is, for prompts and UI. */
export function interviewLabel(c: InterviewConfig): string {
  if (c.mode) return MODE_META[c.mode].label;
  return c.sources.map((s) => SOURCE_META[s].label).join(" + ");
}

/** Sessions predating the name column, and nothing else, read as this. */
export const UNTITLED = "Untitled interview";

/** Matches the suffix this function itself adds, so chains don't nest. */
const RETRY_SUFFIX = /\s*\(retry(?:\s+(\d+))?\)$/i;

/** The DB caps names at 80; the suffix has to fit inside that, not past it. */
const NAME_MAX = 80;

/**
 * Names a re-run of `parentName`.
 *
 * A retry is one click on the report — there's no form to ask for a name, so it
 * derives one. The parent's own suffix is stripped first and the count carried
 * forward, so a retry of a retry is "… (retry 2)" rather than the "… (retry)
 * (retry)" that naive appending produces.
 */
export function retryName(parentName: string | null): string {
  const parent = parentName?.trim() || UNTITLED;
  const prior = RETRY_SUFFIX.exec(parent);
  const base = prior ? parent.slice(0, prior.index) : parent;
  const next = prior ? Number(prior[1] ?? 1) + 1 : 1;

  const suffix = next === 1 ? " (retry)" : ` (retry ${next})`;
  // Trim the base rather than the suffix: "Backend screen (re" tells you
  // nothing, and which retry this is, is the whole point of the name.
  return base.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
}
