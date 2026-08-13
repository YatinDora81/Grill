export const runtime = "nodejs";
// Generation is chunked LLM calls — up to ceil(30/10) + 3 top-ups, each with
// generateJson's own retry inside it. Comfortably past a default timeout, well
// inside the report build's 300s precedent.
export const maxDuration = 120;

import type { GenerateQuestionSetResponse, QuestionSetListResponse } from "@repo/types";
import { json, errorResponse } from "@/lib/http";
import { createQuestionSetSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/db/repo";
import {
  generateQuestionSet,
  toSetDetail,
  toSetSummary,
} from "@/lib/services/questionBankService";

/** The user's question sets, newest first. */
export async function GET() {
  try {
    const userId = await requireUserId();
    const rows = await repo.listQuestionSets(userId);
    return json({
      sets: rows.map((r) =>
        toSetSummary(r, { items: r._count.items, sessions: r._count.sessions }),
      ),
    } satisfies QuestionSetListResponse);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Generate a question set: N standalone questions, persisted as a set the
 * user can read — and, whenever they choose, run an interview on.
 *
 * The whole batch is generated BEFORE anything is written (see
 * questionBankService), so a provider failure costs a request, never a
 * half-empty set. Nothing here creates a session, a turn, or anything else
 * from the interview world — the bank only meets interviews in
 * /api/questions/[setId]/interview.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    // Each set is several LLM calls; per-user ceiling, same idiom as
    // resume-extract. Sized so an impatient double-submit passes but a loop
    // doesn't.
    rateLimit(`question-set:${userId}`, { limit: 6, windowMs: 60_000 });

    const body = createQuestionSetSchema.parse(await req.json());

    // A cultural set brings no material; storing whatever the form happened to
    // hold would leak a résumé into a set that never read it.
    const sourceText = body.source === "cultural" ? "" : body.source_text.trim();
    const role = body.role?.trim() || null;

    const items = await generateQuestionSet(
      { source: body.source, sourceText, role, difficulty: body.difficulty },
      body.count,
    );

    const set = await repo.createQuestionSetWithItems({
      userId,
      name: body.name,
      source: body.source,
      sourceText,
      role,
      difficulty: body.difficulty,
      items,
    });

    return json({
      set: toSetDetail(
        set,
        items.map((q, i) => ({
          item_index: i,
          question: q.question,
          question_type: q.questionType,
        })),
        0,
      ),
    } satisfies GenerateQuestionSetResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
