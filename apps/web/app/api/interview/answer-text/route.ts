export const runtime = "nodejs";

import type { AnswerResponse } from "@repo/types";
import { notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { answerTextSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/db/repo";
import { processAnswer } from "@/lib/services/answerService";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    // Per user, not per IP: this route is authenticated, and every answer costs
    // an LLM scoring call. A real candidate submits once per question and can't
    // approach this; a script pointed at it would otherwise bill us per hit.
    rateLimit(`answer:${userId}`, { limit: 30, windowMs: 60_000 });

    const body = answerTextSchema.parse(await req.json());
    const session = await repo.getSession(body.session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");

    const result: AnswerResponse = await processAnswer({
      session,
      turnIndex: body.turn_index,
      transcript: body.text,
      // A typed answer still happened on camera — the recording never stopped,
      // so the replay can show them typing it.
      videoId: body.video_id ?? null,
      videoOffsetMs: body.video_offset_ms ?? null,
    });
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
