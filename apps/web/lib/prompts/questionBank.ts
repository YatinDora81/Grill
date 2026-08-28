import type { Difficulty, QuestionSetSource } from "@repo/types";
import { DIFFICULTY_META, difficultyLabel } from "@/lib/interviewMeta";

export interface QuestionBankContext {
  source: QuestionSetSource;
  sourceText: string;
  role: string | null;
  difficulty: Difficulty;
}

const RESUME_BAR = `Every question must clear all of this:
- It names something concrete from the résumé — this system, that project, that
  decision. If it could be asked of any other candidate unchanged, it fails.
  No stock prompts ("greatest strength", "where do you see yourself", "explain REST").
- It cannot be answered from the résumé alone. If the text already says it, asking
  it back wastes the slot.
- It cannot be answered yes/no, and it isn't definition recall. Go at judgement:
  why that way, what it cost, what they'd do differently, what they got wrong.
- It stands alone: someone reading only this question, with the résumé in hand,
  knows exactly what is being asked. Never reference "the previous question" or
  "as you said" — there is no conversation.
- No preamble, no praise — the question text is the question only.`;

const TOPIC_BAR = `Every question must clear all of this:
- It is strictly about the named subject — not the reader's career, résumé, or
  workplace stories.
- It cannot be answered yes/no, and it isn't definition recall. Prefer why it
  works, where it breaks, what it costs, when the textbook advice stops being true.
- It stands alone: someone reading only this question knows exactly what is
  being asked. Never reference other questions in the list.
- No preamble — the question text is the question only.`;

const CULTURAL_BAR = `Every question must clear all of this:
- It is about people, values, or working style — never technology. Forbidden:
  how a system works, architecture, languages, frameworks, or résumé projects.
- It forces a real choice or a real story: environment, feedback style, conflict,
  motivation under pressure, what would make them leave, how they push for change.
  Vague fluff ("are you a team player?") is a failed question.
- It cannot be answered yes/no, and it doesn't telegraph the "right" corporate answer.
- It stands alone — never reference other questions in the list.
- No preamble — the question text is the question only.`;

const SOURCE_BAR: Record<QuestionSetSource, string> = {
  resume: RESUME_BAR,
  topic: TOPIC_BAR,
  cultural: CULTURAL_BAR,
};

const RESUME_ANGLES = [
  "what they actually shipped in the most recent role, not what the team shipped",
  "how deep a claimed technology really runs",
  "the part of a highlighted project they'd rather gloss over",
  "a design decision or trade-off implied by the résumé — why that way",
  "scale, reliability or performance implied by the résumé",
  "ownership: something they were on the hook for when it broke",
  "the oldest or least-explained thing in the résumé",
  "a failure, regression or incident the résumé implies but doesn't name",
];

const TOPIC_ANGLES = [
  "why the core of the subject works, not just that it does",
  "a common misconception — whether they hold it",
  "where the subject stops being textbook and becomes a judgement call",
  "the cost side of the subject's usual advice",
  "where the subject's usual advice stops being true",
  "how you'd know an answer was wrong in production",
];

const CULTURAL_ANGLES = [
  "preferred working environment, and why it fits how they show up",
  "how they take feedback — and feedback that stung but was right",
  "a disagreement with someone they still had to work with the next day",
  "a call they got wrong, and what it cost the people around them",
  "what actually keeps them somewhere, and what makes them start looking",
  "pressure: what they're like when the deadline isn't moving",
  "pushing to change a \"this is how we always do it\" attitude",
  "owning a miss that affected other people, not just the work product",
];

const SOURCE_ANGLES: Record<QuestionSetSource, string[]> = {
  resume: RESUME_ANGLES,
  topic: TOPIC_ANGLES,
  cultural: CULTURAL_ANGLES,
};

function shuffled<T>(xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function bankTypeUnion(source: QuestionSetSource): string {
  return source === "cultural" ? `"cultural"` : `"technical" | "cultural"`;
}

export function questionBankSystem(source: QuestionSetSource): string {
  const writer =
    source === "cultural"
      ? "You write culture-fit / behavioural interview question banks."
      : "You are a sharp, fair technical interviewer writing a question bank.";
  return `${writer}
You produce a LIST of standalone practice questions. There is no candidate answering,
no conversation, and no follow-ups — every question must stand entirely on its own.
Pitch every question at the stated difficulty.
${SOURCE_BAR[source]}

Respond with JSON only — no prose, no code fences.`;
}

function contextBlock(c: QuestionBankContext): string {
  const parts = [`Target role: ${c.role ?? "(unspecified)"}`];
  if (c.source === "resume") {
    parts.push("The candidate's résumé — every question grounds in it:", c.sourceText.slice(0, 6_000));
  } else if (c.source === "topic") {
    parts.push(`The subject to drill: ${c.sourceText.slice(0, 2_000)}`);
  } else {
    parts.push(
      "No résumé is provided — do not invent one, and do not ask about specific projects or technology as if you had one.",
    );
  }
  const diff = DIFFICULTY_META[c.difficulty];
  parts.push(`Difficulty: ${difficultyLabel(c.difficulty)}. ${diff.pitch}`);
  return parts.join("\n");
}

export function questionBankPrompt(
  c: QuestionBankContext,
  wantCount: number,
  avoid: string[],
): string {
  const angles = shuffled(SOURCE_ANGLES[c.source])
    .slice(0, Math.min(6, Math.max(3, wantCount)))
    .map((a) => `- ${a}`)
    .join("\n");

  const avoidBlock = avoid.length
    ? `\nThe list must not contain any of the questions below, nor a rephrasing of them:\n${avoid
        .map((q) => `- ${q}`)
        .join("\n")}\n`
    : "";

  return `${contextBlock(c)}

Write EXACTLY ${wantCount} interview practice question${wantCount === 1 ? "" : "s"}.
Spread the list across angles like these rather than circling one:
${angles}
${avoidBlock}
Every question is one ask. If a question contains ", and " followed by another ask, or
more than one "?", it has FAILED — delete the weaker half and keep the sharper one.
No two questions in the list may cover the same ground.

Return JSON: { "questions": [ { "question": string, "question_type": ${bankTypeUnion(c.source)} } ] }
The array must contain exactly ${wantCount} item${wantCount === 1 ? "" : "s"}.`;
}
