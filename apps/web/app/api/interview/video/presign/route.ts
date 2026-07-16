export const runtime = "nodejs";
// A presigned URL is short-lived and per-user; a cached one is both a leak and,
// once expired, a 403.
export const dynamic = "force-dynamic";

import { conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { videoRefSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { config } from "@/lib/env";
import * as repo from "@/lib/db/repo";
import { settleUnfinishedVideos, VIDEO_FLUSH_GRACE_MS } from "@/lib/services/videoService";
import { presignGet } from "@/lib/storage/objectStore";

/** Mint a playback URL for a finished recording. */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { video_id } = videoRefSchema.parse(await req.json());

    let video = await repo.getSessionVideo(video_id, userId);
    if (!video) throw notFound("Recording not found.", "unknown_video");

    if (!video.completedAt) {
      // Settling stitches the upload shut, so it must never touch a recording
      // that is still being written: a live session's parts would stop landing
      // and the interview would keep the footage it had at this instant. An
      // in-progress session is also the one case where "still uploading" is the
      // literal truth, so answer it and leave the upload alone.
      const session = await repo.getSession(video.sessionId, userId);
      if (session?.status === "in_progress") {
        throw conflict("That recording is still uploading.", "video_incomplete");
      }

      // The object does not exist in R2 until the upload is completed — but the
      // parts usually do. A tab that died mid-flush leaves a settleable upload
      // and no server-side event to settle it, so rather than 409ing forever at
      // footage that is sitting right there, stitch it now and serve it.
      // Idempotent and cheap: with nothing to settle this is one indexed read.
      // The grace covers the gap the status check above cannot: a candidate who
      // reaches their report while the tail is still uploading has a session that
      // is no longer `in_progress`, so only the parts themselves still say anyone
      // is writing. Leaving it alone falls through to the 409, which is the
      // honest answer — it really is still uploading.
      await settleUnfinishedVideos(video.sessionId, { graceMs: VIDEO_FLUSH_GRACE_MS }).catch(() => {
        /* best-effort — fall through to the 409 below */
      });
      // Re-read: settling either completed the row or, for an upload that never
      // received a single part, deleted it outright.
      video = await repo.getSessionVideo(video_id, userId);
      if (!video) throw notFound("That recording was never uploaded.", "unknown_video");
      if (!video.completedAt) {
        // Genuinely still in flight — the interview is live and parts are
        // landing. This is the one case the 409 was always meant for.
        throw conflict("That recording is still uploading.", "video_incomplete");
      }
    }

    if (video.expiresAt.getTime() <= Date.now()) {
      // The row may outlive the object by up to a day, until the sweep runs.
      throw notFound("That recording has expired.", "video_expired");
    }

    // The long expiry is load-bearing: a presigned GET is re-authorised on every
    // Range request the <video> element makes while scrubbing, so a short one
    // 403s partway through playback rather than at the start.
    const url = await presignGet(video.key, config.video.playbackExpirySeconds);
    return json({ url, expires_in: config.video.playbackExpirySeconds });
  } catch (err) {
    return errorResponse(err);
  }
}
