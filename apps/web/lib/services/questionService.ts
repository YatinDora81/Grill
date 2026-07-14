import "server-only";
import { generateJson } from "@/lib/clients/llmJson";
import * as repo from "@/lib/db/repo";
import {
  QUESTION_SYSTEM,
  firstQuestionPrompt,
  followUpPrompt,
  type QuestionInputs,
  type SessionContext,
} from "@/lib/prompts/questionGen";
import { questionResponseSchema, type QuestionResponse } from "@/lib/schemas";

/**
 * Pull the per-user material a question needs from the DB.
 *
 * - Past questions, unless they opted into repeats. This is a repeat-practice
 *   tool: the same résumé must not produce the same interview twice.
 * - Weak answers, only for `weak_spots` — that mode is entirely about them.
 */
export async function questionInputs(
  ctx: SessionContext,
  userId: string,
): Promise<QuestionInputs> {
  const [askedBefore, weakSpots] = await Promise.all([
    ctx.config.allow_repeats ? Promise.resolve([]) : repo.listAskedQuestions(userId),
    ctx.config.mode === "weak_spots" ? repo.listWeakTurns(userId) : Promise.resolve([]),
  ]);
  return {
    askedBefore,
    weakSpots: weakSpots.map((w) => ({ question: w.question, transcript: w.transcript })),
  };
}

export async function firstQuestion(
  ctx: SessionContext,
  inputs: QuestionInputs = {},
): Promise<QuestionResponse> {
  const { value } = await generateJson(questionResponseSchema, {
    system: QUESTION_SYSTEM,
    prompt: firstQuestionPrompt(ctx, inputs),
    temperature: 0.8,
  });
  return value;
}

export async function followUp(
  ctx: SessionContext,
  history: { question: string; answer: string }[],
  turnsRemaining: number,
  inputs: QuestionInputs = {},
): Promise<QuestionResponse> {
  const { value } = await generateJson(questionResponseSchema, {
    system: QUESTION_SYSTEM,
    prompt: followUpPrompt(ctx, history, turnsRemaining, inputs),
    temperature: 0.8,
  });
  return value;
}
