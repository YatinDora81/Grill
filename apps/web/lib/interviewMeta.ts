import type { ExclusiveMode, InterviewConfig, InterviewSource } from "@repo/types";

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
export const YEAR_BOUNDS = { min: 1, max: 20 } as const;

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
 * Years of experience → what that rung is called, and how hot it runs.
 *
 * The colour ramp runs green → red, easy → extreme. It's the honest signal:
 * picking VP is not a flattering job title to select, it's a promise that the
 * questions will be brutal.
 */
export interface SeniorityRung {
  label: string;
  /** Inclusive upper bound of this rung, in years. */
  maxYears: number;
  /** Hex, straight from the room palette — green through ember to red. */
  color: string;
  /** What the candidate is being measured against at this rung. */
  blurb: string;
}

export const SENIORITY_LADDER: readonly SeniorityRung[] = [
  { label: "Junior", maxYears: 2, color: "#4ade80", blurb: "Fundamentals, and whether you can explain them." },
  { label: "Mid", maxYears: 5, color: "#a3e635", blurb: "You own features end to end and defend the how." },
  { label: "Senior", maxYears: 9, color: "#f6a64e", blurb: "Trade-offs, failure, and the calls you got wrong." },
  { label: "Staff", maxYears: 13, color: "#fb923c", blurb: "Systems, blast radius, and influence without authority." },
  { label: "Principal", maxYears: 17, color: "#f2642f", blurb: "Strategy, ambiguity, and bets that take a year to prove." },
  { label: "VP", maxYears: 20, color: "#f87171", blurb: "Org design, hard people calls, and answering for outcomes." },
] as const;

export function seniorityFor(years: number): SeniorityRung {
  // The last rung is the ceiling: anything past it is still VP, not undefined.
  return SENIORITY_LADDER.find((r) => years <= r.maxYears) ?? SENIORITY_LADDER[SENIORITY_LADDER.length - 1]!;
}

export function seniorityLabel(years: number): string {
  return seniorityFor(years).label;
}

/** How each source reads in the picker. These combine. */
export const SOURCE_META: Record<InterviewSource, { label: string; blurb: string }> = {
  resume: { label: "Résumé", blurb: "Your own history — what you built, and what you'd rather skip." },
  topic: { label: "Topic", blurb: "A subject you name, tied back to work you've actually done." },
  cultural: { label: "Cultural", blurb: "How you work with people: conflict, failure, judgement." },
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
  weak_spots: {
    label: "Weak spots",
    blurb: "Re-asks the questions you scored worst on in past interviews, plus new ground.",
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
