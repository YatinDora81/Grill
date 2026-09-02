import type {
  ExclusiveMode,
  InterviewConfig,
  InterviewSource,
  InterviewStage,
  QuestionType,
  SourceType,
} from "@repo/types";
import { DIFFICULTY_META, difficultyLabel, personaBrief } from "@/lib/interviewMeta";

export interface WeakSpot {
  question: string;
  transcript: string;
}

export interface SessionContext {
  sourceType: SourceType;
  sourceText: string;
  role: string | null;
  config: InterviewConfig;
}

export interface CompanyBriefContext {
  values: string[];
  style_notes: string[];
}

export interface QuestionInputs {
  askedBefore?: string[];
  weakSpots?: WeakSpot[];
  fixedQuestions?: string[];
  companyBrief?: CompanyBriefContext;
  lastAnswerInterruptedAtS?: number;
}

const JSON_ONLY = "Respond with JSON only — no prose, no code fences.";

export function questionSystemProse(c: InterviewConfig): string {
  const voice = personaBrief(c.persona);
  const persona = voice ? `\n${voice}\n` : "";
  if (culturalOnly(c)) {
    return `You are a sharp, fair interviewer running a culture-fit / behavioural interview.
Ask ONE question at a time about how this person works with people, takes feedback, handles
pressure, and decides what kind of workplace they thrive in.
Pitch every question at the stated difficulty, and follow the interview brief.
Do not ask about systems, code, architecture, or résumé projects. Do not answer for the candidate.
${persona}
${CULTURAL_QUALITY_BAR}`;
  }
  return `You are a sharp, fair technical interviewer running a mock interview.
Ask ONE question at a time. Questions must be specific and grounded in the provided context.
Pitch every question at the stated difficulty, and follow the interview brief.
Do not answer for the candidate.
${persona}
${TECHNICAL_QUALITY_BAR}`;
}

export function questionSystem(c: InterviewConfig): string {
  return `${questionSystemProse(c)}

${JSON_ONLY}`;
}

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

const CULTURAL_THREAD = `
This is a culture-fit interview. When the answer contains technical detail, do not follow the
technology — follow the person in it: the judgement, the pressure, who else was affected, what
they'd do differently. Never ask how a system works, why it broke, or about résumé projects.
`;

const ONE_QUESTION = `
HARD CONSTRAINT — one question, one ask. Reread your question before answering: if it contains
", and " followed by another ask, or more than one "?", you have FAILED and must rewrite it.
Delete the weaker half; keep the sharper one. You get to ask the other next turn.
Bad:  "What was the bottleneck, and how did you fix it?"
Good: "What was the bottleneck?"`;

export function culturalOnly(c: InterviewConfig): boolean {
  if (c.mode === "cultural_only") return true;
  return c.mode === null && c.sources.length > 0 && c.sources.every((s) => s === "cultural");
}

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
  'how they\'d change an institutional "this is how we always do it" attitude if they saw a better way',
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

const PROJECT_OPENERS = [
  "the core architectural decision of the project — why this shape and not the obvious alternative",
  "the data model — what it makes easy, and the query or write it makes painful",
  "a dependency or framework choice they would have to defend to a sceptical senior engineer",
  "what happens when the project meets 100x its current load — the first thing that falls over",
  "the hardest bug or failure the project has had, or plausibly will have",
  "security and auth in the project — who can do what, and how that is actually enforced",
  "the part of the project the brief flags as weakest or least finished",
  "what they would rewrite first if they started the project again, and why they did not do it that way",
] as const;

const PROJECT_NEXT_AREAS = [
  "a component or feature of the project that has not come up yet",
  "testing, deployment or observability — how they actually know the project works",
  "a trade-off in the project they have not had to defend yet",
  "an edge case or failure mode implied by the project's own design",
  "how the project would have to change with a real team and real users",
  "depth on something in the project they mentioned only in passing",
] as const;

const SOURCE_NEXT_AREAS: Record<InterviewSource, readonly string[]> = {
  resume: TECHNICAL_NEXT_AREAS,
  topic: TOPIC_NEXT_AREAS,
  cultural: CULTURAL_NEXT_AREAS,
};

const MODE_OPENERS: Record<ExclusiveMode, readonly string[]> = {
  topic_only: TOPIC_OPENERS,
  cultural_only: CULTURAL_OPENERS,
  jd: RESUME_OPENERS,
  real: RESUME_OPENERS,
  weak_spots: RESUME_OPENERS,
  starred: RESUME_OPENERS,
  project: PROJECT_OPENERS,
};

const MODE_NEXT_AREAS: Record<ExclusiveMode, readonly string[]> = {
  topic_only: TOPIC_NEXT_AREAS,
  cultural_only: CULTURAL_NEXT_AREAS,
  jd: TECHNICAL_NEXT_AREAS,
  real: TECHNICAL_NEXT_AREAS,
  weak_spots: TECHNICAL_NEXT_AREAS,
  starred: TECHNICAL_NEXT_AREAS,
  project: PROJECT_NEXT_AREAS,
};

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
  starred: () =>
    "This is a drill on questions the candidate saved for themselves because those questions caught them out. The primaries are fixed and listed below — ask them back word for word, in the order given. Facing the same question again is the whole point, so do not soften it, modernise it, or swap it for a better one of your own.",
  project: () =>
    "Interview them on THE PROJECT in the context below, as its builder. Every question must be " +
    "grounded in that project: why it is built the way it is, what that cost, where it breaks, what " +
    "they would redo. If a résumé is also present it is background only — do not drift into general " +
    "résumé or career questions.",
};

const SOURCE_BRIEF: Record<InterviewSource, (c: InterviewConfig) => string> = {
  resume: () => "their own history — what they built, and what they'd rather gloss over",
  topic: (c) =>
    `the subject "${c.topic}" — tie it back to work they have actually done wherever you can`,
  cultural: () =>
    "culture fit — working style, values, conflict, feedback, motivation, and the environment where they thrive (not technology or résumé projects)",
};

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

function brief(c: InterviewConfig, hasWeakSpots = true): string {
  if (c.mode === "weak_spots" && !hasWeakSpots) {
    return `Interview them on ${SOURCE_BRIEF.resume(c)}.`;
  }
  return c.mode ? MODE_BRIEF[c.mode](c) : sourcesBrief(c);
}

const STAGE_PLAN: {
  stage: InterviewStage;
  fixed?: { minTotal: number };
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

function stageCounts(total: number): number[] {
  const counts = STAGE_PLAN.map(() => 0);

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

const EMITTED_TYPES: QuestionType[] = ["technical", "cultural", "followup"];

const TYPE_UNION = EMITTED_TYPES.map((t) => `"${t}"`).join(" | ");

const SOURCE_LABEL: Record<SourceType, string> = {
  resume: "The candidate's résumé",
  jd: "The target job description (older session — no résumé on file)",
  topic: "The requested topic (older session — no résumé on file)",
};

function companyBlock(c: InterviewConfig, brief: CompanyBriefContext | undefined): string {
  const company = c.company?.trim();
  if (!company) return "";

  const title = c.job_title?.trim();
  const location = c.job_location?.trim();
  const lines = [
    `This posting is at ${company}${title ? ` — ${title}` : ""}${location ? `, ${location}` : ""}. Ask as an interviewer there would; do not claim facts about the company that the posting does not state.`,
  ];

  const values = brief?.values.filter((v) => v.trim()) ?? [];
  const style = brief?.style_notes.filter((n) => n.trim()) ?? [];
  if (values.length) lines.push(`Their stated values: ${values.join("; ")}.`);
  if (style.length) lines.push(`Their interviews are known for: ${style.join("; ")}.`);
  if (values.length || style.length) {
    lines.push(
      "Let this shape WHAT you probe, not how hard you probe — the difficulty and the rubric do not move.",
    );
  }
  return lines.join("\n");
}

function contextBlock(s: SessionContext, inputs: QuestionInputs = {}): string {
  const c = s.config;
  const parts = [`Interview target role: ${s.role ?? "(unspecified)"}`];

  if (c.mode === "project") {
    parts.push(
      "The candidate's project — they built this; the interview is about it:",
      (c.project_context ?? "").slice(0, 8_000),
    );
    if (c.project_repo_url) parts.push(`Project repository: ${c.project_repo_url}`);
    if (s.sourceText.trim()) {
      parts.push(
        "Their résumé, background only — questions stay on the project:",
        s.sourceText.slice(0, 2_500),
      );
    }
  } else if (c.mode !== "topic_only" && !culturalOnly(c)) {
    parts.push(`${SOURCE_LABEL[s.sourceType]}:`, s.sourceText.slice(0, 6000));
  } else if (culturalOnly(c)) {
    parts.push(
      "No résumé is provided for this interview — do not invent one, and do not ask about projects or technology as if you had one.",
    );
  }
  if (c.job_description) {
    const company = companyBlock(c, inputs.companyBrief);
    if (company) parts.push(company);
    parts.push("The job description they are targeting:", c.job_description.slice(0, 4000));
  }
  const diff = DIFFICULTY_META[c.difficulty];
  parts.push(
    `Difficulty: ${difficultyLabel(c.difficulty)}. ${diff.pitch}`,
    `Total questions: ${c.num_questions}.`,
  );
  return parts.join("\n");
}

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

function fixedBlock(fixed: string[] | undefined): string {
  if (!fixed?.length) return "";
  return `\nThe primaries for this interview are fixed, in this order — ask each verbatim as the next
primary question; your freedom is the follow-up after each answer, exactly as usual:
${fixed.map((q, i) => `${i + 1}. ${q}`).join("\n")}
These are exempt from every do-not-repeat rule above and below: they were chosen precisely
because the candidate has faced them before.\n`;
}

function fixedLeft(fixed: string[] | undefined, history: { question: string }[]): string[] {
  if (!fixed?.length) return [];
  const asked = new Set(history.map((h) => h.question));
  return fixed.filter((q) => !asked.has(q));
}

export function firstQuestionPrompt(
  s: SessionContext,
  inputs: QuestionInputs = {},
  angle = pick(anglesFor(s.config, SOURCE_OPENERS, MODE_OPENERS)),
): string {
  const mode = s.config.mode;
  const stage = mode === "real" ? `\n${stageBlock(0, s.config.num_questions)}\n` : "";

  const aim =
    mode === "weak_spots" && inputs.weakSpots?.length
      ? "Open on the weakest of the answers listed above."
      : inputs.fixedQuestions?.length
        ? "Ask fixed primary 1 above, word for word."
        : mode === "topic_only"
          ? `Open on the core of the topic: ${s.config.topic}`
          : mode === "real"
            ? ""
            : `Open on: ${angle}`;

  const opener =
    mode === "real"
      ? "Follow the stage brief above."
      : inputs.fixedQuestions?.length
        ? "Do not reword it, do not soften it, and do not write an opener of your own."
        : culturalOnly(s.config)
          ? `Do not use a stock opener ("tell me about yourself", "walk me through your resume", "greatest strength").
Go straight at a culture-fit angle — working style, values, conflict, feedback, or environment.`
          : `Do not use a stock opener ("tell me about yourself", "walk me through your resume/background").
Go straight at something concrete.`;

  return `${contextBlock(s, inputs)}

${brief(s.config, !!inputs.weakSpots?.length)}
${stage}${weakSpotBlock(inputs.weakSpots)}${fixedBlock(inputs.fixedQuestions)}${askedBlock(inputs.askedBefore)}
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

  const areaHint =
    mode === "real"
      ? " that the stage brief above calls for."
      : ` — this time, lean toward: ${newArea}`;

  const transcript = history
    .map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer || "(no clear answer)"}`)
    .join("\n\n");

  const owed = fixedLeft(inputs.fixedQuestions, history);
  const ask = owed.length
    ? `Ask the NEXT question.
${
  turnsRemaining + 1 > owed.length
    ? `If the last answer opens a worthwhile thread you may spend this turn on ONE targeted follow-up
into something the candidate actually said; otherwise ask fixed primary 1 above, word for word.`
    : `Every question left is spoken for: ask fixed primary 1 above, word for word, and do not follow up.`
}
Never reword, soften or replace a fixed primary. Never re-ask anything else already covered above.`
    : `Ask the NEXT question. If the last answer opens a worthwhile thread, ask a targeted follow-up
that digs into something the candidate actually said; otherwise move to a new area${areaHint}
Never re-ask something already covered above, and don't rephrase a question they've answered.`;

  const cutIn =
    inputs.lastAnswerInterruptedAtS === undefined
      ? ""
      : `
The interviewer cut the candidate off at ${inputs.lastAnswerInterruptedAtS}s because the answer ran
long. Your next question must make them land the point in one or two sentences — the result, the
number, or the decision — before any new ground.
`;

  return `${contextBlock(s, inputs)}

${brief(s.config, !!inputs.weakSpots?.length)}
${stage}${weakSpotBlock(inputs.weakSpots)}${fixedBlock(owed)}${askedBlock(inputs.askedBefore)}
Conversation so far:
${transcript}

There are ${turnsRemaining} question(s) left after this one.
${ask}
${cutIn}${culturalOnly(s.config) ? CULTURAL_THREAD : ""}${ONE_QUESTION}
Return JSON: { "question": string, "question_type": ${typeUnionFor(s.config)} }`;
}

export type QuestionTypeOut = QuestionType;
