export const runtime = "nodejs";
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

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`question-set:${userId}`, { limit: 6, windowMs: 60_000 });

    const body = createQuestionSetSchema.parse(await req.json());

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
