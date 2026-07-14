export const runtime = "nodejs";

import type { StartResponse } from "@repo/types";
import { badRequest, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { sessionIdSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";

/**
 * Re-run an earlier interview on exactly the same questions.
 *
 * Nothing is generated here — that's the point. The questions are copied
 * verbatim so the two runs are measuring the same material and their reports
 * can be compared; a fresh question set would make the comparison meaningless.
 * The re-run is a full session of its own (own answers, own report), linked
 * back via retryOfId. A retry can itself be retried: the link points at the
 * immediate parent, so the chain walks back one hop at a time.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { session_id } = sessionIdSchema.parse(await req.json());

    // User-scoped: someone else's session id is simply "not found".
    const parent = await repo.getSession(session_id, userId);
    if (!parent) throw notFound("Interview not found.", "unknown_session");

    const turns = await repo.getTurns(session_id);
    if (!turns.length) {
      throw badRequest("That interview has no questions to retry.", "nothing_to_retry");
    }

    const session = await repo.createSession({
      userId,
      // Same material, verbatim — a retry that changed the inputs wouldn't be
      // measuring the same thing.
      sourceType: parent.sourceType,
      sourceText: parent.sourceText,
      role: parent.role,
      config: parent.config as never,
      retryOfId: parent.id,
    });

    await repo.copyQuestionsInto(session.id, parent.id);

    const first = turns[0]!;
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
