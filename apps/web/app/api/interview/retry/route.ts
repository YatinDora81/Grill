export const runtime = "nodejs";

import type { StartResponse } from "@repo/types";
import { badRequest, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { sessionIdSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { retryName } from "@/lib/interviewMeta";
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

    // getTurns sorts by turnIndex, and copyQuestionsInto reproduces those
    // indices verbatim — so the retry's first question is the parent's first,
    // whatever it was numbered. The room then decides "answered everything"
    // with `turnIndex + 1 >= numQuestions`, which silently assumes 0-based
    // contiguous indices. That holds today (/start writes 0..n-1 and nothing
    // deletes a turn), but no type enforces it, so check before we create
    // anything rather than let a violation surface as a retry that ends the
    // interview early.
    const first = turns[0]!;
    if (first.turnIndex !== 0) {
      throw badRequest(
        "That interview's questions are numbered unexpectedly and can't be retried.",
        "nonzero_first_turn",
      );
    }

    const session = await repo.createSession({
      userId,
      // Same material, verbatim — a retry that changed the inputs wouldn't be
      // measuring the same thing.
      sourceType: parent.sourceType,
      sourceText: parent.sourceText,
      // Derived, never asked for: a retry is started from one button on the
      // report, and stopping to demand a name would be a form in the way of a
      // single click. `retryName` counts the chain so a retry of a retry reads
      // "… (retry 2)" rather than "… (retry) (retry)".
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
