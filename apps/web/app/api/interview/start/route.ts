export const runtime = "nodejs";

import type { StartResponse } from "@repo/types";
import { json, errorResponse } from "@/lib/http";
import { startRequestSchema, interviewConfigSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { firstQuestion, questionInputs } from "@/lib/services/questionService";
import { toSessionContext } from "@/lib/services/sessionContext";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = startRequestSchema.parse(await req.json());
    const cfg = interviewConfigSchema.parse(body.config ?? {});

    const session = await repo.createSession({
      userId,
      // Always a résumé now — the mode chooses what to ask on top of it.
      sourceType: "resume",
      sourceText: body.source_text,
      role: body.role ?? null,
      config: cfg,
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
