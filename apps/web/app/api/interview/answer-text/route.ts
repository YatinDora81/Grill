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
    await rateLimit(`answer:${userId}`, { limit: 30, windowMs: 60_000 });

    const body = answerTextSchema.parse(await req.json());
    const session = await repo.getSession(body.session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");

    const result: AnswerResponse = await processAnswer({
      session,
      turnIndex: body.turn_index,
      transcript: body.text,
      videoId: body.video_id ?? null,
      videoOffsetMs: body.video_offset_ms ?? null,
      cameraMetrics: body.camera_metrics ?? null,
    });
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
