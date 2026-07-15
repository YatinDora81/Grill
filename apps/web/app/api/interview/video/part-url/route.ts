export const runtime = "nodejs";

import { conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { videoPartUrlSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { presignUploadPart } from "@/lib/storage/objectStore";

/**
 * Sign one part URL so the browser can PUT it straight to R2.
 *
 * The bytes never touch this server — they can't. A Vercel function's request
 * body caps at 4.5 MB and R2's minimum part is 5 MiB, so anything that fits
 * through here is too small to be a part.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { video_id, part_number } = videoPartUrlSchema.parse(await req.json());

    // User-scoped: signing an upload URL for someone else's key would be a
    // write primitive handed to a stranger.
    const video = await repo.getSessionVideo(video_id, userId);
    if (!video) throw notFound("Recording not found.", "unknown_video");
    if (!video.uploadId || video.completedAt) {
      throw conflict("That recording is already finished.", "video_completed");
    }

    return json({ url: await presignUploadPart(video.key, video.uploadId, part_number) });
  } catch (err) {
    return errorResponse(err);
  }
}
