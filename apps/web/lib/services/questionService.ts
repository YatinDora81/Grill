import "server-only";
import { generateJson } from "@/lib/clients/llmJson";
import { badRequest } from "@/lib/errors";
import * as repo from "@/lib/db/repo";
import {
  questionSystem,
  firstQuestionPrompt,
  followUpPrompt,
  type CompanyBriefContext,
  type QuestionInputs,
  type SessionContext,
} from "@/lib/prompts/questionGen";
import { questionResponseSchema, type QuestionResponse } from "@/lib/schemas";
import { briefForQuestions } from "@/lib/services/companyBriefService";

export async function questionInputs(
  ctx: SessionContext,
  userId: string,
  opts: { requireStars?: boolean } = {},
): Promise<QuestionInputs> {
  const [askedBefore, weakSpots, stars, companyBrief] = await Promise.all([
    ctx.config.allow_repeats ? Promise.resolve([]) : repo.listAskedQuestions(userId),
    ctx.config.mode === "weak_spots" ? repo.listWeakTurns(userId) : Promise.resolve([]),
    ctx.config.mode === "starred" ? repo.listStarredQuestions(userId) : Promise.resolve([]),
    companyContext(ctx),
  ]);

  const fixedQuestions = fixedFromStars(stars, ctx.config.starred_hashes);
  if (opts.requireStars && ctx.config.mode === "starred" && fixedQuestions.length === 0) {
    throw badRequest(
      "None of those saved questions are still starred — pick again from /starred.",
      "no_starred_questions",
    );
  }

  const reopening = new Set([...weakSpots.map((w) => w.question), ...fixedQuestions]);
  return {
    askedBefore: askedBefore.filter((q) => !reopening.has(q)),
    weakSpots: weakSpots.map((w) => ({ question: w.question, transcript: w.transcript })),
    fixedQuestions,
    ...(companyBrief ? { companyBrief } : {}),
  };
}

async function companyContext(ctx: SessionContext): Promise<CompanyBriefContext | null> {
  if (ctx.config.mode !== "jd" || !ctx.config.company?.trim()) return null;
  try {
    return await briefForQuestions(ctx.config.company, ctx.config.job_title ?? ctx.role);
  } catch (err) {
    console.warn("[questionService] could not read the company brief:", err);
    return null;
  }
}

function fixedFromStars(
  stars: { question: string; questionHash: string }[],
  hashes: string[] | undefined,
): string[] {
  if (!hashes?.length) return [];
  const byHash = new Map(stars.map((s) => [s.questionHash, s.question]));
  return hashes.map((h) => byHash.get(h)).filter((q): q is string => q !== undefined);
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
