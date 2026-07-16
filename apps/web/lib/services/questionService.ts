import "server-only";
import { generateJson } from "@/lib/clients/llmJson";
import * as repo from "@/lib/db/repo";
import {
  questionSystem,
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
 *   Soft-deleted interviews do not count — those questions are fair game again.
 * - Weak answers, only for `weak_spots` — that mode is entirely about them
 *   (also ignoring soft-deleted sessions).
 */
export async function questionInputs(
  ctx: SessionContext,
  userId: string,
): Promise<QuestionInputs> {
  const [askedBefore, weakSpots] = await Promise.all([
    ctx.config.allow_repeats ? Promise.resolve([]) : repo.listAskedQuestions(userId),
    ctx.config.mode === "weak_spots" ? repo.listWeakTurns(userId) : Promise.resolve([]),
  ]);

  // A weak spot is by definition a question already asked, so it lands in both
  // lists — and the prompt then says "re-ask this" and "never ask this again"
  // about the same text, with the ban reading last. Since repeats are off by
  // default, that was the *default* weak_spots session: the one mode whose whole
  // point is reopening old ground was banned from reaching it. Subtract rather
  // than skip, so the repeat ban still holds for every other past question.
  const reopening = new Set(weakSpots.map((w) => w.question));
  return {
    askedBefore: askedBefore.filter((q) => !reopening.has(q)),
    weakSpots: weakSpots.map((w) => ({ question: w.question, transcript: w.transcript })),
  };
}

export async function firstQuestion(
  ctx: SessionContext,
  inputs: QuestionInputs = {},
): Promise<QuestionResponse> {
  const { value } = await generateJson(questionResponseSchema, {
    system: questionSystem(ctx.config),
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
    system: questionSystem(ctx.config),
    prompt: followUpPrompt(ctx, history, turnsRemaining, inputs),
    temperature: 0.8,
  });
  return value;
}
