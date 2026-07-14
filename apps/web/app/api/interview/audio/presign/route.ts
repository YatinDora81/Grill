export const runtime = "nodejs";

import type { PresignResponse } from "@repo/types";
import { notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { turnRefSchema } from "@/lib/schemas";
import { config } from "@/lib/env";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { presignGet } from "@/lib/storage/objectStore";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(req.url);
    const { session_id, turn_index } = turnRefSchema.parse({
      session_id: url.searchParams.get("session_id"),
      turn_index: url.searchParams.get("turn_index"),
    });

    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");
    const turn = await repo.getTurn(session_id, turn_index);
    if (!turn?.audioKey) throw notFound("No audio for that turn.", "no_audio");

    const signed = await presignGet(turn.audioKey);
    return json({ url: signed, expires_in: config.presignExpirySeconds } satisfies PresignResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
