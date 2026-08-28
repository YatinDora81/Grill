export const runtime = "nodejs";

import type { DeleteSessionResponse } from "@repo/types";
import { notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { sessionIdSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { settleUnfinishedVideos } from "@/lib/services/videoService";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { session_id } = sessionIdSchema.parse(await req.json());
    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");

    await settleUnfinishedVideos(session_id).catch(() => {});

    const ok = await repo.softDeleteSession(session_id, userId);
    if (!ok) throw notFound("Session not found.", "unknown_session");

    return json({ session_id, deleted: true } satisfies DeleteSessionResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
