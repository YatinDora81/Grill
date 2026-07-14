import type {
  InterviewConfig,
  InterviewMode,
  InterviewStage,
  QuestionType,
  SourceType,
} from "@repo/types";

export interface WeakSpot {
  question: string;
  transcript: string;
}

export interface SessionContext {
  sourceType: SourceType;
  /** The résumé. Always present — it's the candidate. */
  sourceText: string;
  role: string | null;
  config: InterviewConfig;
}

/** Extra material the services fetch from the DB per request. */
export interface QuestionInputs {
  /** Questions this user has already been asked; forbidden when repeats are off. */
  askedBefore?: string[];
  /** Their worst-scored past answers — the point of `weak_spots`. */
  weakSpots?: WeakSpot[];
}

export const QUESTION_SYSTEM = `You are a sharp, fair technical interviewer running a mock interview.
Ask ONE question at a time. Questions must be specific and grounded in the provided context.
Match the requested difficulty and interview type. Do not answer for the candidate.
Respond with JSON only — no prose, no code fences.`;

/**
 * The same résumé produced the same interview every time. Temperature wasn't
 * the culprit (it's 0.8): the prompt was byte-identical, and on a task this
 * constrained the model still walks to its single most-likely opener. So vary
 * the *instruction* — each session draws an angle of attack, which changes what
 * is being asked for rather than just how it's sampled.
 */
const OPENING_ANGLES = [
  "the most recent role in the résumé — what they actually shipped, not what the team shipped",
  "a specific technology the résumé claims depth in — find out how deep it really runs",
  "a project the résumé highlights — go at the part they'd rather gloss over",
  "a design decision or trade-off implied by the résumé — why it went that way",
  "scale, reliability or performance implied by the résumé",
  "ownership: something in the résumé they were on the hook for when it broke",
  "the gap between what the résumé claims and what the target role demands",
  "the oldest or least-explained thing in the résumé",
] as const;

const NEXT_AREA_ANGLES = [
  "a technology or system that hasn't come up yet",
  "how they work with other people",
  "a failure, regression or incident implied by the context",
  "a trade-off they haven't had to defend yet",
  "depth on something they mentioned only in passing",
  "an area that is conspicuously vague",
] as const;

function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]!;
}

/** What each mode is actually for, in the interviewer's own terms. */
const MODE_BRIEF: Record<InterviewMode, (c: InterviewConfig) => string> = {
  resume: () =>
    "Interview them on their own history. Every question must come from the résumé.",
  topic: (c) =>
    `Drill them on: ${c.topic}. Stay grounded in the résumé — prefer questions that connect the topic to work they have actually done.`,
  topic_only: (c) =>
    `Drill them on: ${c.topic}. Ignore the résumé entirely; this is a pure subject examination.`,
  jd: () =>
    "Interview them for the job description below, using the résumé to judge whether they can actually do it. Probe the gaps between the two.",
  real: () =>
    "Run this like a real interview: it moves through stages, and you will be told which stage you are in.",
  weak_spots: () =>
    "This is a retry session. The candidate answered the questions below badly in earlier interviews; the point is to make them face that ground again — not to be gentle about it.",
};

/**
 * A real interview has a shape: warm up, then dig, then find out what they're
 * like to work with.
 */
const STAGE_PLAN: { stage: InterviewStage; share: number; brief: string }[] = [
  {
    stage: "basic",
    share: 0.25,
    brief:
      "Opening ground. Straightforward, answerable questions about who they are and what they've built. Settle them in — but stay specific to the résumé.",
  },
  {
    stage: "technical",
    share: 0.4,
    brief:
      "The technical core. Go deep on systems, trade-offs and decisions. This is where the interview is actually won or lost.",
  },
  {
    stage: "tricky_cultural",
    share: 0.2,
    brief:
      "A tricky cultural question — conflict, disagreement with a manager, a call they got wrong, pressure from a deadline. Make it uncomfortable but fair. There is no clean answer.",
  },
  {
    stage: "cultural",
    share: 0.15,
    brief:
      "Straight cultural fit: how they work, what they want, how they treat the people around them.",
  },
];

/**
 * How many questions each stage gets, summing to exactly `total`.
 *
 * Rounding each share independently doesn't work: at 8 questions the parts sum
 * to 7, and at 4 they sum to 5 — which walked the cursor past the end and meant
 * a "real interview" never reached its cultural close. So floor the shares and
 * hand out what's left by largest remainder, which always lands on `total`.
 *
 * Once there's room for the whole arc (>= 4 questions) every stage is
 * guaranteed one, because an interview that skips the cultural close isn't the
 * thing we promised. Below that the arc genuinely doesn't fit and the later
 * stages drop.
 */
function stageCounts(total: number): number[] {
  const raw = STAGE_PLAN.map((s) => s.share * total);
  const floor = total >= STAGE_PLAN.length ? 1 : 0;
  const counts = raw.map((r) => Math.max(floor, Math.floor(r)));

  const byRemainder = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);

  let used = counts.reduce((a, b) => a + b, 0);
  for (let k = 0; used < total; k++, used++) counts[byRemainder[k % byRemainder.length]!.i]!++;
  while (used > total) {
    // Reclaim from the fattest stage that can spare one without going under the
    // floor — technical, in practice, which is the one that can afford it.
    let biggest = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i]! > floor && (biggest === -1 || counts[i]! > counts[biggest]!)) biggest = i;
    }
    if (biggest === -1) break;
    counts[biggest]!--;
    used--;
  }
  return counts;
}

/** Which stage question `index` of `total` falls in. */
export function stageFor(index: number, total: number): InterviewStage {
  const counts = stageCounts(total);
  let cursor = 0;
  for (let i = 0; i < STAGE_PLAN.length; i++) {
    cursor += counts[i]!;
    if (index < cursor) return STAGE_PLAN[i]!.stage;
  }
  return "cultural";
}

function stageBlock(index: number, total: number): string {
  const stage = stageFor(index, total);
  const plan = STAGE_PLAN.find((s) => s.stage === stage)!;
  return `Stage: ${stage.toUpperCase()} (question ${index + 1} of ${total}).\n${plan.brief}`;
}

/**
 * What the model may label a question. `behavioral` is deliberately absent — it
 * and `cultural` always meant the same thing, so only `cultural` gets written
 * from here on.
 */
const EMITTED_TYPES: QuestionType[] = ["technical", "cultural", "followup"];

const TYPE_UNION = EMITTED_TYPES.map((t) => `"${t}"`).join(" | ");

/**
 * New sessions always carry a résumé. Legacy ones put a job description or a
 * topic in the same field, so label it for what it actually is rather than
 * telling the model a pasted posting is the candidate's own history.
 */
const SOURCE_LABEL: Record<SourceType, string> = {
  resume: "The candidate's résumé",
  jd: "The target job description (older session — no résumé on file)",
  topic: "The requested topic (older session — no résumé on file)",
};

function contextBlock(s: SessionContext): string {
  const c = s.config;
  const parts = [`Interview target role: ${s.role ?? "(unspecified)"}`];

  // topic_only is the one mode that must not see the résumé — including it
  // "just as context" is exactly how a pure-subject drill drifts back into
  // being a résumé interview.
  if (c.mode !== "topic_only") {
    parts.push(`${SOURCE_LABEL[s.sourceType]}:`, s.sourceText.slice(0, 6000));
  }
  if (c.job_description) {
    parts.push("The job description they are targeting:", c.job_description.slice(0, 4000));
  }
  parts.push(
    `Difficulty: ${c.difficulty}. Interview type: ${c.interview_type}. Total questions: ${c.num_questions}.`,
  );
  return parts.join("\n");
}

function askedBlock(asked: string[] | undefined): string {
  if (!asked?.length) return "";
  return `\nThis candidate has already been asked the questions below in previous interviews.
Do NOT ask any of them again, and do not merely rephrase them — they are practising, and a repeat is a wasted question:
${asked.map((q) => `- ${q}`).join("\n")}\n`;
}

function weakSpotBlock(weak: WeakSpot[] | undefined): string {
  if (!weak?.length) return "";
  return `\nThe candidate previously answered these badly. Revisit this ground — re-ask a question that
attacks the same weakness, reworded and ideally sharper. Do not copy the wording verbatim:
${weak.map((w) => `- Q: ${w.question}\n  Their weak answer: ${(w.transcript || "(no clear answer)").slice(0, 300)}`).join("\n")}\n`;
}

export function firstQuestionPrompt(
  s: SessionContext,
  inputs: QuestionInputs = {},
  angle = pick(OPENING_ANGLES),
): string {
  const mode = s.config.mode;
  const stage = mode === "real" ? `\n${stageBlock(0, s.config.num_questions)}\n` : "";

  // In weak_spots the whole point is to reopen old ground, so the opener aims
  // at a weak answer rather than a random angle.
  const aim =
    mode === "weak_spots" && inputs.weakSpots?.length
      ? "Open on the weakest of the answers listed above."
      : mode === "topic_only"
        ? `Open on the core of the topic: ${s.config.topic}`
        : `Open on: ${angle}`;

  return `${contextBlock(s)}

${MODE_BRIEF[mode](s.config)}
${stage}${weakSpotBlock(inputs.weakSpots)}${askedBlock(inputs.askedBefore)}
Ask the FIRST interview question.
${aim}
Do not use a stock opener ("tell me about yourself", "walk me through your resume/background").
Go straight at something concrete.
Return JSON: { "question": string, "question_type": ${TYPE_UNION} }`;
}

export function followUpPrompt(
  s: SessionContext,
  history: { question: string; answer: string }[],
  turnsRemaining: number,
  inputs: QuestionInputs = {},
  newArea = pick(NEXT_AREA_ANGLES),
): string {
  const mode = s.config.mode;
  const total = s.config.num_questions;
  const index = history.length;
  const stage = mode === "real" ? `\n${stageBlock(index, total)}\n` : "";

  const transcript = history
    .map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer || "(no clear answer)"}`)
    .join("\n\n");

  return `${contextBlock(s)}

${MODE_BRIEF[mode](s.config)}
${stage}${weakSpotBlock(inputs.weakSpots)}${askedBlock(inputs.askedBefore)}
Conversation so far:
${transcript}

There are ${turnsRemaining} question(s) left after this one.
Ask the NEXT question. If the last answer opens a worthwhile thread, ask a targeted follow-up
that digs into something the candidate actually said; otherwise move to a new area — this time,
lean toward: ${newArea}
Never re-ask something already covered above, and don't rephrase a question they've answered.
Return JSON: { "question": string, "question_type": ${TYPE_UNION} }`;
}

export type QuestionTypeOut = QuestionType;
