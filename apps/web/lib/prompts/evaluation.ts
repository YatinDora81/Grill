import type { QuestionType } from "@repo/types";

export const EVALUATION_SYSTEM = `You score a single interview answer on a fixed rubric.
Scoring scale for every dimension (1-10):
  1-3 vague / off-topic / incorrect · 4-6 partial · 7-8 solid · 9-10 expert with concrete examples.
Judge ONLY the words the candidate said. Never judge tone, pace, or confidence — you cannot hear audio.
Respond with JSON only — no prose, no code fences.`;

export function evaluationPrompt(
  question: string,
  questionType: QuestionType,
  answer: string,
): string {
  return `Question (${questionType}): ${question}

Candidate answer (transcript):
${answer || "(no clear answer was given)"}

Score this answer. Return JSON:
{
  "relevance": number,     // does it address the question
  "correctness": number,   // factual/technical accuracy
  "structure": number,     // logical structure; for behavioral use STAR
  "depth": number,         // detail, tradeoffs, examples
  "filler": number         // 10 = crisp, 1 = rambling/lots of filler
}`;
}
