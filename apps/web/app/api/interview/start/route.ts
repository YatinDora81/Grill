export const runtime = "nodejs";

import type { StartResponse } from "@repo/types";
import { badRequest } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { startRequestSchema } from "@/lib/schemas";
import { perAnswerCapSeconds } from "@/lib/interviewMeta";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { firstQuestion, questionInputs } from "@/lib/services/questionService";
import { toSessionContext } from "@/lib/services/sessionContext";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    // One parse, not two: `startRequestSchema` already validates the config, and
    // re-parsing it here would run the source/mode refinements a second time.
    const body = startRequestSchema.parse(await req.json());

    // Derived here and nowhere else. The form may show this number, but it is
    // never the client's to choose — a config arriving with its own
    // max_answer_seconds is overwritten below, not honoured.
    const cap = perAnswerCapSeconds(body.config.num_questions);
    if (cap === null) {
      // This many clips can't be analysed inside the report's 300s budget.
      // Refuse now: creating the interview would mean letting someone answer
      // every question before discovering the report can never build.
      throw badRequest(
        "That many questions can't be scored in time — reduce the question count.",
        "too_many_questions",
      );
    }
    const config = { ...body.config, max_answer_seconds: cap };

    const session = await repo.createSession({
      userId,
      // Always a résumé now — the sources choose what to ask on top of it.
      sourceType: "resume",
      sourceText: body.source_text,
      name: body.name,
      role: body.role ?? null,
      config,
    });

    const ctx = toSessionContext(session);
    const q = await firstQuestion(ctx, await questionInputs(ctx, userId));
    await repo.createTurn({
      sessionId: session.id,
      turnIndex: 0,
      question: q.question,
      questionType: q.question_type,
    });

    return json({
      session_id: session.id,
      turn_index: 0,
      question: q.question,
      question_type: q.question_type,
    } satisfies StartResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
