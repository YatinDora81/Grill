export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { videoRefSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { config } from "@/lib/env";
import * as repo from "@/lib/db/repo";
import { settleUnfinishedVideos, VIDEO_FLUSH_GRACE_MS } from "@/lib/services/videoService";
import { presignGet } from "@/lib/storage/objectStore";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { video_id } = videoRefSchema.parse(await req.json());

    let video = await repo.getSessionVideo(video_id, userId);
    if (!video) throw notFound("Recording not found.", "unknown_video");

    if (!video.completedAt) {
      const session = await repo.getSession(video.sessionId, userId);
      if (session?.status === "in_progress") {
        throw conflict("That recording is still uploading.", "video_incomplete");
      }

      await settleUnfinishedVideos(video.sessionId, { graceMs: VIDEO_FLUSH_GRACE_MS }).catch(
        () => {},
      );
      video = await repo.getSessionVideo(video_id, userId);
      if (!video) throw notFound("That recording was never uploaded.", "unknown_video");
      if (!video.completedAt) {
        throw conflict("That recording is still uploading.", "video_incomplete");
      }
    }

    if (video.expiresAt.getTime() <= Date.now()) {
      throw notFound("That recording has expired.", "video_expired");
    }

    const url = await presignGet(video.key, config.video.playbackExpirySeconds);
    return json({ url, expires_in: config.video.playbackExpirySeconds });
  } catch (err) {
    return errorResponse(err);
  }
}
