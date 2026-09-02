export const runtime = "nodejs";

import { conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { sessionIdSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/db/repo";
import { toSessionContext } from "@/lib/services/sessionContext";
import { releaseLiveSlot } from "@/lib/services/liveService";

export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`live-opt-out:${userId}`, { limit: 12, windowMs: 60_000 });

    const { session_id } = sessionIdSchema.parse(await req.json());
    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");
    if (session.status !== "in_progress") {
      throw conflict(`Session is ${session.status}.`, "session_not_active");
    }

    const ctx = toSessionContext(session);
    if (ctx.config.live) {
      await repo.updateSessionConfig(session_id, { ...ctx.config, live: false });
      await releaseLiveSlot(session_id);
    }

    return json({ session_id, live: false });
  } catch (err) {
    return errorResponse(err);
  }
}
