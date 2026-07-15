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
import { presignGet } from "@/lib/storage/objectStore";

/** Mint a playback URL for a finished recording. */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { video_id } = videoRefSchema.parse(await req.json());

    const video = await repo.getSessionVideo(video_id, userId);
    if (!video) throw notFound("Recording not found.", "unknown_video");
    if (!video.completedAt) {
      // The object does not exist in R2 until the upload is completed.
      throw conflict("That recording is still uploading.", "video_incomplete");
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
