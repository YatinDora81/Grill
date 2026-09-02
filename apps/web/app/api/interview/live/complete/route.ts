export const runtime = "nodejs";
export const maxDuration = 300;

import { conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { liveCompleteSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/db/repo";
import { toSessionContext } from "@/lib/services/sessionContext";
import { persistLiveTurns, releaseLiveSlot } from "@/lib/services/liveService";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`live-complete:${userId}`, { limit: 12, windowMs: 60_000 });

    const { session_id, turns } = liveCompleteSchema.parse(await req.json());
    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");
    if (session.status !== "in_progress") {
      throw conflict(`Session is ${session.status}.`, "session_not_active");
    }

    const ctx = toSessionContext(session);
    if (!ctx.config.live) throw conflict("This interview is not a live session.", "not_live");

    const opener = await repo.getTurn(session_id, 0);
    if (!opener) throw conflict("The interview has no opening question.", "unknown_turn");
    if (opener.transcript !== null) {
      throw conflict("This live conversation was already saved.", "already_completed");
    }

    const written = await persistLiveTurns(session, turns);
    await releaseLiveSlot(session_id);

    return json({ session_id, turns: written });
  } catch (err) {
    return errorResponse(err);
  }
}
