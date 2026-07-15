export const runtime = "nodejs";

import { conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { videoStartSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { config } from "@/lib/env";
import * as repo from "@/lib/db/repo";
import { PART_BYTES, createMultipart, videoKey } from "@/lib/storage/objectStore";
import { settleUnfinishedVideos } from "@/lib/services/videoService";

const EXT: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/x-matroska": "mkv",
};

/**
 * Begin a session recording: open a multipart upload and hand back its id.
 *
 * No server timestamp comes back on purpose. Answer offsets are measured on the
 * client against the same clock that starts the mic, so a server clock here
 * would only invite someone to mix the two.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { session_id, mime_type } = videoStartSchema.parse(await req.json());

    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");
    if (session.status !== "in_progress") {
      throw conflict(`Session is ${session.status}, not recording.`, "session_not_active");
    }

    // A reload starts a fresh recording; the previous one's upload is still open
    // and holding real footage. Close it out before opening another.
    await settleUnfinishedVideos(session_id).catch(() => {
      /* best-effort: never block the interview on housekeeping */
    });

    // The id is minted here, not by the DB, because the object key embeds it —
    // letting Prisma default it would key the object to one id and the row to
    // another, and nothing would ever find the video again.
    const id = crypto.randomUUID();
    const base = mime_type.split(";")[0]!.trim().toLowerCase();
    const key = videoKey(session_id, id, EXT[base] ?? "webm");
    const uploadId = await createMultipart(key, base);

    await repo.createSessionVideo({
      id,
      sessionId: session_id,
      key,
      uploadId,
      expiresAt: new Date(Date.now() + config.video.retentionDays * 86_400_000),
    });

    return json({ video_id: id, part_bytes: PART_BYTES });
  } catch (err) {
    return errorResponse(err);
  }
}
