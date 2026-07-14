import "server-only";
import type { AnswerScores, QuestionType } from "@repo/types";
import { generateJson } from "@/lib/clients/llmJson";
import { EVALUATION_SYSTEM, evaluationPrompt } from "@/lib/prompts/evaluation";
import { answerScoresSchema } from "@/lib/schemas";

/** Score one answer against the fixed rubric (§scoring). */
export async function scoreAnswer(
  question: string,
  questionType: QuestionType,
  answer: string,
): Promise<AnswerScores> {
  const { value } = await generateJson(answerScoresSchema, {
    system: EVALUATION_SYSTEM,
    prompt: evaluationPrompt(question, questionType, answer),
    temperature: 0.2,
  });
  return value;
}
