import type {
  ExclusiveMode,
  InterviewConfig,
  InterviewSource,
  InterviewStage,
  QuestionType,
  SourceType,
} from "@repo/types";
import { DIFFICULTY_META, difficultyLabel } from "@/lib/interviewMeta";

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

/**
 * A cultural-only interview has no technical ground to stand on, and calling
 * the model a "technical interviewer" there quietly re-technicalises questions
 * the brief just asked to be about people.
 */
export function questionSystem(c: InterviewConfig): string {
  if (culturalOnly(c)) {
    return `You are a sharp, fair interviewer running a culture-fit / behavioural interview.
Ask ONE question at a time about how this person works with people, takes feedback, handles
pressure, and decides what kind of workplace they thrive in.
Pitch every question at the stated difficulty, and follow the interview brief.
Do not ask about systems, code, architecture, or résumé projects. Do not answer for the candidate.

${CULTURAL_QUALITY_BAR}

Respond with JSON only — no prose, no code fences.`;
  }
  return `You are a sharp, fair technical interviewer running a mock interview.
Ask ONE question at a time. Questions must be specific and grounded in the provided context.
Pitch every question at the stated difficulty, and follow the interview brief.
Do not answer for the candidate.

${TECHNICAL_QUALITY_BAR}

Respond with JSON only — no prose, no code fences.`;
}

/**
 * The bar a technical / résumé interview question has to clear.
 *
 * Left to itself the model writes the interview question it has seen most often
 * — stock, compound, and answerable by anyone — because nothing in the prompt
 * ever said what a bad question looks like. Naming the failure modes is what
 * moves it; "ask a good question" does not.
 */
const TECHNICAL_QUALITY_BAR = `A question earns its place only if it clears all of this:
- It names something concrete from the context — this system, that project, that
  decision. If the question could be asked of any other candidate unchanged, it is
  the wrong question. No stock prompts ("greatest strength", "where do you see
  yourself", "explain REST").
- It cannot be answered from the résumé alone. If the text already says it, asking
  it back wastes the turn.
- It cannot be answered yes/no, and it isn't definition recall. Go at judgement:
  why that way, what it cost, what they'd do differently, what they got wrong.
- It doesn't telegraph the answer you're fishing for.
- No preamble, no praise, no "great answer" — the question text is the question only.`;

/**
 * Culture-fit interviews are about the person, not the stack. The technical bar
 * above demands project grounding; handed a résumé it quietly rewrites every
 * "how do you work" ask into "tell me about that Postgres ledger". This bar is
 * the opposite: situations, values, working style — never systems.
 */
const CULTURAL_QUALITY_BAR = `A question earns its place only if it clears all of this:
- It is about people, values, or working style — not technology. Forbidden topics:
  how a system works, why something broke technically, architecture, languages,
  frameworks, or "walk me through a project on your résumé".
- It forces a real choice or a real story: preferred environment, feedback style,
  conflict, motivation under pressure, what would make them leave, how they push
  for change. Vague fluff ("are you a team player?") is a failed question.
- It cannot be answered yes/no. Dig into why, what they'd do, what it cost them
  or the people around them.
- It doesn't telegraph the "right" corporate answer.
- No preamble, no praise — the question text is the question only.`;

/**
 * Follow-ups are where a cultural interview leaks back into a technical one.
 *
 * Source-aware angles only govern the *new area* branch; the other branch tells
 * the model to dig into whatever the candidate just said. Candidates answer
 * behavioural questions with technical detail ("the ledger drifted so I re-ran
 * the job"), the model pulls that thread, and the next question is "what caused
 * the drift?" — a technical question in an interview that has no technical
 * source. The thread is worth following; the *technology* in it is not.
 */
const CULTURAL_THREAD = `
This is a culture-fit interview. When the answer contains technical detail, do not follow the
technology — follow the person in it: the judgement, the pressure, who else was affected, what
they'd do differently. Never ask how a system works, why it broke, or about résumé projects.
`;

/**
 * The one-question rule, as the last thing the model reads.
 *
 * Compound questions ("...what was the trade-off, and how did you fix it?") are
 * the strongest failure mode here — both providers default to them, because a
 * stapled question is what the training data calls an interview question. The
 * rule is in QUALITY_BAR too and there it did nothing; position and bluntness
 * are what move it. Measured stapled rates, small samples but consistent across
 * two models: Gemini 43% over 30 questions with a polite mid-prompt rule; the
 * wording below scored 17% (Gemini, n=12) and 20% (Groq, n=5) against 67% and
 * 86% for the polite version. Treat those as direction, not precision.
 *
 * If this regresses, the next step is mechanical rather than rhetorical: detect
 * the staple and re-ask, instead of asking the model more nicely.
 */
const ONE_QUESTION = `
HARD CONSTRAINT — one question, one ask. Reread your question before answering: if it contains
", and " followed by another ask, or more than one "?", you have FAILED and must rewrite it.
Delete the weaker half; keep the sharper one. You get to ask the other next turn.
Bad:  "What was the bottleneck, and how did you fix it?"
Good: "What was the bottleneck?"`;

/**
 * No technical ground at all — exclusive Cultural only, or every blend source
 * is cultural. Either way the résumé must not enter the prompt.
 */
export function culturalOnly(c: InterviewConfig): boolean {
  if (c.mode === "cultural_only") return true;
  return c.mode === null && c.sources.length > 0 && c.sources.every((s) => s === "cultural");
}

/**
 * The same résumé produced the same interview every time. Temperature wasn't
 * the culprit (it's 0.8): the prompt was byte-identical, and on a task this
 * constrained the model still walks to its single most-likely opener. So vary
 * the *instruction* — each session draws an angle of attack, which changes what
 * is being asked for rather than just how it's sampled.
 *
 * The pools are per-source because the angle is the most specific instruction in
 * the prompt, and the most specific instruction is the one that gets obeyed: a
 * résumé angle handed to a cultural interview overrides its own brief and asks
 * a technical question anyway.
 */
const RESUME_OPENERS = [
  "the most recent role in the résumé — what they actually shipped, not what the team shipped",
  "a specific technology the résumé claims depth in — find out how deep it really runs",
  "a project the résumé highlights — go at the part they'd rather gloss over",
  "a design decision or trade-off implied by the résumé — why it went that way",
  "scale, reliability or performance implied by the résumé",
  "ownership: something in the résumé they were on the hook for when it broke",
  "the gap between what the résumé claims and what the target role demands",
  "the oldest or least-explained thing in the résumé",
] as const;

const TOPIC_OPENERS = [
  "the core of the subject — whether they understand why it works, not just that it does",
  "the subject as it shows up in work they've actually done",
  "a common misconception about the subject — see whether they hold it",
  "where the subject stops being textbook and starts being a judgement call",
] as const;

const CULTURAL_OPENERS = [
  "whether they prefer working alone or as part of a team — and why that fits how they show up",
  "the kind of work environment where they are most productive",
  "how they prefer to get feedback — formal reviews vs daily/weekly check-ins — and why",
  "what they hope to achieve in their first six months somewhere new",
  "what would make them quit a job in the first month",
  "how they motivate a team (or themselves) during a challenging project",
  "one thing from a prior job they'd want to keep wherever they go next",
  "a company policy they found unfair or inefficient — what it was and why",
  "their manager assigns a big task right before the end of the day — how they reply",
  "how they'd change an institutional \"this is how we always do it\" attitude if they saw a better way",
  "a disagreement with someone they still had to work with the next day",
  "a call they got wrong, and what it cost the people around them",
  "feedback that stung at the time and turned out to be right",
  "what they're like when the pressure is on and the deadline isn't moving",
] as const;

const TECHNICAL_NEXT_AREAS = [
  "a technology or system that hasn't come up yet",
  "how they work with other people",
  "a failure, regression or incident implied by the context",
  "a trade-off they haven't had to defend yet",
  "depth on something they mentioned only in passing",
  "an area that is conspicuously vague",
] as const;

const CULTURAL_NEXT_AREAS = [
  "conflict, when the other person was never going to budge",
  "what they do once it's clear they're the one who's wrong",
  "working with someone whose style is nothing like theirs",
  "what actually keeps them somewhere, and what makes them start looking",
  "how they take hard feedback without getting defensive",
  "aligning with company values when the easy path cuts against them",
  "adapting when priorities flip mid-project and someone is unhappy",
  "owning a miss that affected other people — not just the work product",
  "an area that is conspicuously vague",
] as const;

const SOURCE_OPENERS: Record<InterviewSource, readonly string[]> = {
  resume: RESUME_OPENERS,
  topic: TOPIC_OPENERS,
  cultural: CULTURAL_OPENERS,
};

const TOPIC_NEXT_AREAS = [
  "a part of the subject that hasn't come up yet",
  "where the subject's usual advice stops being true",
  "the cost side of something they just praised",
  "how they'd know their answer was wrong in production",
  "depth on something they mentioned only in passing",
  "an area that is conspicuously vague",
] as const;

const SOURCE_NEXT_AREAS: Record<InterviewSource, readonly string[]> = {
  resume: TECHNICAL_NEXT_AREAS,
  topic: TOPIC_NEXT_AREAS,
  cultural: CULTURAL_NEXT_AREAS,
};

/**
 * Exclusive modes carry no sources, so the pool is chosen by mode instead.
 *
 * `topic_only` may not use TECHNICAL_NEXT_AREAS: those angles reach for the
 * résumé and for how they work with people, and a pure subject drill is defined
 * by ignoring both. `real` never reads these — its stage brief picks the area.
 */
const MODE_OPENERS: Record<ExclusiveMode, readonly string[]> = {
  topic_only: TOPIC_OPENERS,
  cultural_only: CULTURAL_OPENERS,
  jd: RESUME_OPENERS,
  real: RESUME_OPENERS,
  weak_spots: RESUME_OPENERS,
};

const MODE_NEXT_AREAS: Record<ExclusiveMode, readonly string[]> = {
  topic_only: TOPIC_NEXT_AREAS,
  cultural_only: CULTURAL_NEXT_AREAS,
  jd: TECHNICAL_NEXT_AREAS,
  real: TECHNICAL_NEXT_AREAS,
  weak_spots: TECHNICAL_NEXT_AREAS,
};

/**
 * The angles this interview is allowed to draw from: the union of its sources'
 * pools, so a blend can go anywhere its brief allows while a single-source
 * interview can only go where that source lives. An exclusive mode has no
 * sources, so it draws from the pool its own shape implies.
 */
function anglesFor(
  c: InterviewConfig,
  table: Record<InterviewSource, readonly string[]>,
  modeTable: Record<ExclusiveMode, readonly string[]>,
): readonly string[] {
  const pool = c.sources.flatMap((s) => table[s]);
  if (pool.length) return pool;
  return c.mode ? modeTable[c.mode] : table.resume;
}

function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]!;
}

/** What each exclusive mode is actually for, in the interviewer's own terms. */
const MODE_BRIEF: Record<ExclusiveMode, (c: InterviewConfig) => string> = {
  topic_only: (c) =>
    `Drill them on: ${c.topic}. Ignore the résumé entirely; this is a pure subject examination.`,
  cultural_only: () =>
    "Run a culture-fit interview. Ignore the résumé and any technical depth entirely. Ask about working style, values, conflict, feedback, motivation, and the kind of environment where they thrive — the questions a hiring manager uses to see whether someone will flourish on this team.",
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
    "culture fit — working style, values, conflict, feedback, motivation, and the environment where they thrive (not technology or résumé projects)",
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

/**
 * The instruction that tells the model what interview it is running.
 *
 * `weak_spots` is briefed on "the questions below" — so with no scored history
 * to draw on, that brief points at a list that isn't there and the model is left
 * inventing what it was supposed to be re-asking. A first-time user reaching the
 * mode early gets a plain résumé interview instead of a dangling reference.
 */
function brief(c: InterviewConfig, hasWeakSpots = true): string {
  if (c.mode === "weak_spots" && !hasWeakSpots) {
    return `Interview them on ${SOURCE_BRIEF.resume(c)}.`;
  }
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
      "Fundamentals, pitched at the stated difficulty — not textbook recall, but whether they understand why the thing works. Easy stays approachable; Extreme separates knowing from having done it.",
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

  // topic_only and cultural-only must not see the résumé — including it
  // "just as context" is exactly how those interviews drift back into asking
  // about projects, systems, and tech the brief told them to ignore.
  if (c.mode !== "topic_only" && !culturalOnly(c)) {
    parts.push(`${SOURCE_LABEL[s.sourceType]}:`, s.sourceText.slice(0, 6000));
  } else if (culturalOnly(c)) {
    parts.push(
      "No résumé is provided for this interview — do not invent one, and do not ask about projects or technology as if you had one.",
    );
  }
  if (c.job_description) {
    parts.push("The job description they are targeting:", c.job_description.slice(0, 4000));
  }
  const diff = DIFFICULTY_META[c.difficulty];
  parts.push(
    `Difficulty: ${difficultyLabel(c.difficulty)}. ${diff.pitch}`,
    `Total questions: ${c.num_questions}.`,
  );
  return parts.join("\n");
}

/** What the model may emit for this interview shape. */
function typeUnionFor(c: InterviewConfig): string {
  if (culturalOnly(c)) return `"cultural" | "followup"`;
  return TYPE_UNION;
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
  angle = pick(anglesFor(s.config, SOURCE_OPENERS, MODE_OPENERS)),
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
      : culturalOnly(s.config)
        ? `Do not use a stock opener ("tell me about yourself", "walk me through your resume", "greatest strength").
Go straight at a culture-fit angle — working style, values, conflict, feedback, or environment.`
        : `Do not use a stock opener ("tell me about yourself", "walk me through your resume/background").
Go straight at something concrete.`;

  return `${contextBlock(s)}

${brief(s.config, !!inputs.weakSpots?.length)}
${stage}${weakSpotBlock(inputs.weakSpots)}${askedBlock(inputs.askedBefore)}
Ask the FIRST interview question.
${aim}
${opener}
${culturalOnly(s.config) ? CULTURAL_THREAD : ""}${ONE_QUESTION}
Return JSON: { "question": string, "question_type": ${typeUnionFor(s.config)} }`;
}

export function followUpPrompt(
  s: SessionContext,
  history: { question: string; answer: string }[],
  turnsRemaining: number,
  inputs: QuestionInputs = {},
  newArea = pick(anglesFor(s.config, SOURCE_NEXT_AREAS, MODE_NEXT_AREAS)),
): string {
  const mode = s.config.mode;
  const total = s.config.num_questions;
  const index = history.length;
  const stage = mode === "real" ? `\n${stageBlock(index, total)}\n` : "";

  // `real` already knows what this question is: the stage brief says so, by
  // name. A random angle here is the same mistake that made cultural-only ask
  // technical questions — the more specific instruction wins, and this one is
  // both more specific and read later than the brief. At the last question that
  // costs the interview its ending: the close is "do you have any questions for
  // us?", and "lean toward a technology that hasn't come up yet" is not that.
  const areaHint =
    mode === "real"
      ? " that the stage brief above calls for."
      : ` — this time, lean toward: ${newArea}`;

  const transcript = history
    .map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer || "(no clear answer)"}`)
    .join("\n\n");

  return `${contextBlock(s)}

${brief(s.config, !!inputs.weakSpots?.length)}
${stage}${weakSpotBlock(inputs.weakSpots)}${askedBlock(inputs.askedBefore)}
Conversation so far:
${transcript}

There are ${turnsRemaining} question(s) left after this one.
Ask the NEXT question. If the last answer opens a worthwhile thread, ask a targeted follow-up
that digs into something the candidate actually said; otherwise move to a new area${areaHint}
Never re-ask something already covered above, and don't rephrase a question they've answered.
${culturalOnly(s.config) ? CULTURAL_THREAD : ""}${ONE_QUESTION}
Return JSON: { "question": string, "question_type": ${typeUnionFor(s.config)} }`;
}

export type QuestionTypeOut = QuestionType;
