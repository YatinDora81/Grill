export const runtime = "nodejs";

import type { StartResponse } from "@repo/types";
import { badRequest, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { sessionIdSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { retryName } from "@/lib/interviewMeta";
import * as repo from "@/lib/db/repo";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { session_id } = sessionIdSchema.parse(await req.json());

    const parent = await repo.getSession(session_id, userId);
    if (!parent) throw notFound("Interview not found.", "unknown_session");

    const turns = await repo.getTurns(session_id);
    if (!turns.length) {
      throw badRequest("That interview has no questions to retry.", "nothing_to_retry");
    }

    const first = turns[0]!;
    if (first.turnIndex !== 0) {
      throw badRequest(
        "That interview's questions are numbered unexpectedly and can't be retried.",
        "nonzero_first_turn",
      );
    }

    const session = await repo.createSession({
      userId,
      sourceType: parent.sourceType,
      sourceText: parent.sourceText,
      name: retryName(parent.name),
      role: parent.role,
      config: parent.config as never,
      retryOfId: parent.id,
    });

    await repo.copyQuestionsInto(session.id, parent.id);

    return json({
      session_id: session.id,
      turn_index: first.turnIndex,
      question: first.question,
      question_type: first.questionType,
    } satisfies StartResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
