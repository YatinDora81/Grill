export const runtime = "nodejs";

import type { StartResponse, TurnPayload } from "@repo/types";
import { badRequest } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { startRequestSchema } from "@/lib/schemas";
import { drillTurnBudget, perAnswerCapSeconds } from "@/lib/interviewMeta";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import type { SessionContext } from "@/lib/prompts/questionGen";
import {
  CODING_ANSWER_CAP_S,
  DESIGN_ANSWER_CAP_S,
  generateCodingQuestion,
  questionTextFor,
  turnsFor,
} from "@/lib/services/codingService";
import { firstDesignTurn } from "@/lib/services/designService";
import { firstQuestion, questionInputs } from "@/lib/services/questionService";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = startRequestSchema.parse(await req.json());

    const round = body.config.round ?? "spoken";
    const problems = body.config.problems ?? 2;

    let numQuestions: number;
    let cap: number;
    if (round === "spoken") {
      numQuestions =
        body.config.mode === "starred" && body.config.starred_hashes?.length
          ? drillTurnBudget(body.config.starred_hashes.length)
          : body.config.num_questions;

      const spokenCap = perAnswerCapSeconds(numQuestions);
      if (spokenCap === null) {
        throw badRequest(
          "That many questions can't be scored in time — reduce the question count.",
          "too_many_questions",
        );
      }
      cap = spokenCap;
    } else {
      numQuestions = turnsFor(problems);
      cap = round === "coding" ? CODING_ANSWER_CAP_S : DESIGN_ANSWER_CAP_S;
    }
    const config = { ...body.config, num_questions: numQuestions, max_answer_seconds: cap };

    const ctx: SessionContext = {
      sourceType: "resume",
      sourceText: body.source_text,
      role: body.role ?? null,
      config,
    };
    const inputs = await questionInputs(ctx, userId, { requireStars: true });

    const session = await repo.createSession({
      userId,
      sourceType: "resume",
      sourceText: body.source_text,
      name: body.name,
      role: body.role ?? null,
      config,
    });

    const first: {
      question: string;
      question_type: StartResponse["question_type"];
      payload: TurnPayload | null;
    } =
      round === "coding"
        ? await (async () => {
            const payload = await generateCodingQuestion(ctx, inputs, 0, problems);
            return {
              question: questionTextFor(payload),
              question_type: "technical" as const,
              payload,
            };
          })()
        : round === "design"
          ? await firstDesignTurn(ctx, inputs)
          : { ...(await firstQuestion(ctx, inputs)), payload: null };

    await repo.createTurn({
      sessionId: session.id,
      turnIndex: 0,
      question: first.question,
      questionType: first.question_type,
      questionPayload: first.payload,
    });

    return json({
      session_id: session.id,
      turn_index: 0,
      question: first.question,
      question_type: first.question_type,
    } satisfies StartResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
