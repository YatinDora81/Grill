import type {
  ExclusiveMode,
  InterviewConfig,
  InterviewSource,
  InterviewStage,
  QuestionType,
  SourceType,
} from "@repo/types";
import { seniorityLabel } from "@/lib/interviewMeta";

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
Pitch every question at the candidate's stated years of experience, and follow the interview brief.
Do not answer for the candidate.
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

/** What each exclusive mode is actually for, in the interviewer's own terms. */
const MODE_BRIEF: Record<ExclusiveMode, (c: InterviewConfig) => string> = {
  topic_only: (c) =>
    `Drill them on: ${c.topic}. Ignore the résumé entirely; this is a pure subject examination.`,
  jd: () =>
    "Interview them for the job description below, using the résumé to judge whether they can actually do it. Probe the gaps between the two.",
  real: () =>
    "Run this like a real interview: it moves through stages, and you will be told which stage you are in.",
  weak_spots: () =>
    "This is a retry session. The candidate answered the questions below badly in earlier interviews; the point is to make them face that ground again — not to be gentle about it.",
};

/** What each source contributes to a blended interview. */
const SOURCE_BRIEF: Record<InterviewSource, (c: InterviewConfig) => string> = {
  resume: () => "their own history — what they built, and what they'd rather gloss over",
  topic: (c) =>
    `the subject "${c.topic}" — tie it back to work they have actually done wherever you can`,
  cultural: () =>
    "how they work with people — conflict, failure, judgement calls, what they're like to sit next to",
};

/**
 * The brief for a blended interview.
 *
 * One interview that moves between its sources, not several bolted together:
 * left to itself the model will happily do all the résumé questions, then all
 * the topic ones, which is three interviews in a trench coat.
 */
function sourcesBrief(c: InterviewConfig): string {
  const briefs = c.sources.map((s) => `- ${SOURCE_BRIEF[s](c)}`);
  if (briefs.length === 1) {
    return `Interview them on ${c.sources.map((s) => SOURCE_BRIEF[s](c)).join("")}.`;
  }
  return `This interview draws on all of the following, blended into one conversation:
${briefs.join("\n")}
Move between them as a real interviewer would — follow what the candidate says rather than
working through the list in order. By the end, every one of them must have been covered.`;
}

/** The instruction that tells the model what interview it is running. */
function brief(c: InterviewConfig): string {
  return c.mode ? MODE_BRIEF[c.mode](c) : sourcesBrief(c);
}

/**
 * The arc of a real interview, in order.
 *
 * Three of these are moments rather than sections — the opener, the thread
 * pulled out of it, and the close — and each is exactly one question however
 * long the interview runs. A 40-question interview does not want eight
 * "tell me about yourself"s. The middle three scale to fill whatever is left.
 */
const STAGE_PLAN: {
  stage: InterviewStage;
  /** Exactly one question, once the interview is long enough to afford it. */
  fixed?: { minTotal: number };
  /** Share of whatever the fixed stages leave behind. */
  share?: number;
  brief: string;
}[] = [
  {
    stage: "intro",
    fixed: { minTotal: 1 },
    brief:
      'The opener. Ask them to introduce themselves — this is the one time the stock "tell me about yourself" is correct, because it is how every real interview starts. Keep it open.',
  },
  {
    stage: "intro_followup",
    fixed: { minTotal: 5 },
    brief:
      "Pull one thread out of the introduction they just gave. Something they said, not something from the résumé they didn't mention. Show them you were listening.",
  },
  {
    stage: "resume",
    share: 0.35,
    brief:
      "Their actual history. Go at what they built, what they owned, and the parts they'd rather skip past.",
  },
  {
    stage: "concepts",
    share: 0.35,
    brief:
      "Fundamentals, pitched at their years of experience — not textbook recall, but whether they understand why the thing works. Scale this with the experience level given above: a 2-year candidate gets the basics, a 15-year candidate gets the questions that separate knowing from having done it.",
  },
  {
    stage: "depth",
    share: 0.3,
    brief:
      "Where it gets hard. Trade-offs, failure, scale, the call they got wrong, disagreement with a manager. Uncomfortable but fair — there is no clean answer.",
  },
  {
    stage: "closing",
    fixed: { minTotal: 2 },
    brief:
      'The close: "Do you have any questions for us?" — exactly as a real interviewer ends. Ask it plainly and let them take it wherever they want.',
  },
];

/**
 * How many questions each stage gets, summing to exactly `total`.
 *
 * Fixed stages are paid first, in the order they'd be missed: the opener, then
 * the close, then the intro follow-up — a short interview should lose the
 * follow-up before it loses its ending. Whatever survives is split among the
 * scaling stages by largest remainder, which is the only part that has to land
 * exactly on `total`. (Rounding each share independently doesn't: the parts sum
 * to 7 at total 8, which walks the cursor off the end and means the interview
 * never reaches its close.)
 */
function stageCounts(total: number): number[] {
  const counts = STAGE_PLAN.map(() => 0);

  // Paid in priority order, not plan order — hence the explicit list.
  const fixedPriority: InterviewStage[] = ["intro", "closing", "intro_followup"];
  let spent = 0;
  for (const stage of fixedPriority) {
    const i = STAGE_PLAN.findIndex((s) => s.stage === stage);
    const plan = STAGE_PLAN[i]!;
    if (total >= plan.fixed!.minTotal && spent < total) {
      counts[i] = 1;
      spent++;
    }
  }

  const scaling = STAGE_PLAN.map((s, i) => ({ i, share: s.share })).filter(
    (s): s is { i: number; share: number } => s.share !== undefined,
  );
  const rest = total - spent;
  if (rest <= 0) return counts;

  const raw = scaling.map((s) => s.share * rest);
  raw.forEach((r, k) => (counts[scaling[k]!.i] = Math.floor(r)));

  let used = raw.reduce((a, r) => a + Math.floor(r), 0);
  const byRemainder = raw
    .map((r, k) => ({ i: scaling[k]!.i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; used < rest; k++, used++) counts[byRemainder[k % byRemainder.length]!.i]!++;

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
  return "closing";
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
  // Years, not a difficulty label: "senior" means something different to every
  // model and every company, whereas "11 years" is a fact it can pitch against.
  parts.push(
    `Candidate experience level: ${c.years_experience} year(s) — ${seniorityLabel(c.years_experience)}. Pitch the questions at someone with that much time in the field.`,
    `Total questions: ${c.num_questions}.`,
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
        : mode === "real"
          ? "" // the stage brief already says exactly what the opener is
          : `Open on: ${angle}`;

  // A `real` interview is the one case where the stock opener is the right
  // opener — its first stage IS "introduce yourself", and banning it there would
  // fight the arc. Everywhere else the ban stands.
  const opener =
    mode === "real"
      ? "Follow the stage brief above."
      : `Do not use a stock opener ("tell me about yourself", "walk me through your resume/background").
Go straight at something concrete.`;

  return `${contextBlock(s)}

${brief(s.config)}
${stage}${weakSpotBlock(inputs.weakSpots)}${askedBlock(inputs.askedBefore)}
Ask the FIRST interview question.
${aim}
${opener}
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

${brief(s.config)}
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
