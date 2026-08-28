export const runtime = "nodejs";

import { conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { videoPartUrlSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { presignUploadPart } from "@/lib/storage/objectStore";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { video_id, part_number } = videoPartUrlSchema.parse(await req.json());

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
