export const runtime = "nodejs";

import type { DeleteQuestionSetResponse, GenerateQuestionSetResponse } from "@repo/types";
import { notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { setIdParamsSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { toItemDTO, toSetDetail } from "@/lib/services/questionBankService";

/** One set, with every question in reading order. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ setId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { setId } = setIdParamsSchema.parse(await params);

    // User-scoped: someone else's set id is simply "not found".
    const set = await repo.getQuestionSet(setId, userId);
    if (!set) throw notFound("Question set not found.", "unknown_set");

    const items = await repo.getQuestionSetItems(setId);
    return json({
      set: toSetDetail(set, items.map(toItemDTO), set._count.sessions),
    } satisfies GenerateQuestionSetResponse);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Soft-delete a set. Interviews already run from it are untouched — they own
 * verbatim copies of the questions — so nothing they replay or report on can
 * dangle. Same contract as deleting an interview.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ setId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { setId } = setIdParamsSchema.parse(await params);

    const ok = await repo.softDeleteQuestionSet(setId, userId);
    if (!ok) throw notFound("Question set not found.", "unknown_set");

    return json({ set_id: setId, deleted: true } satisfies DeleteQuestionSetResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
