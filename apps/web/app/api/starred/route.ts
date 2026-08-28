export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { starSchema, unstarSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";

export async function GET() {
  try {
    const userId = await requireUserId();
    const rows = await repo.listStarredQuestions(userId);
    return json({
      starred: rows.map((r) => ({
        id: r.id,
        question: r.question,
        question_type: r.questionType,
        question_hash: r.questionHash,
        created_at: r.createdAt.toISOString(),
        session_id: r.turn?.sessionId ?? null,
        turn_index: r.turn?.turnIndex ?? null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { turn_id } = starSchema.parse(await req.json());

    const turn = await repo.getTurnForUser(turn_id, userId);
    if (!turn) throw notFound("Question not found.", "unknown_turn");

    const row = await repo.starQuestion(userId, turn);
    return json({ ok: true, question_hash: row.questionHash });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId();
    const { question_hash } = unstarSchema.parse(await req.json());
    const { count } = await repo.unstarQuestion(userId, question_hash);
    return json({ ok: true, removed: count });
  } catch (err) {
    return errorResponse(err);
  }
}
