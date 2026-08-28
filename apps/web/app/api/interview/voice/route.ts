export const runtime = "nodejs";

import type { VoiceResponse } from "@repo/types";
import { badRequest, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { voiceRequestSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/db/repo";
import { questionAudio } from "@/lib/services/voiceService";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`voice:${userId}`, { limit: 60, windowMs: 60_000 });

    const { session_id, turn_index } = voiceRequestSchema.parse(await req.json());

    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");

    const turn = await repo.getTurn(session_id, turn_index);
    if (!turn) throw badRequest("That question isn't part of this interview.", "unknown_turn");

    const payload = await questionAudio(session, turn);
    return json(payload satisfies VoiceResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
