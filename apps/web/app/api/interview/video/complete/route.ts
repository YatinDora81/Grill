export const runtime = "nodejs";

import { notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { videoRefSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { abortMultipart, completeMultipart, listParts } from "@/lib/storage/objectStore";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { video_id } = videoRefSchema.parse(await req.json());

    const video = await repo.getSessionVideo(video_id, userId);
    if (!video) throw notFound("Recording not found.", "unknown_video");
    if (video.completedAt || !video.uploadId) return json({ ok: true, parts: null });

    const parts = await listParts(video.key, video.uploadId);
    if (parts.length === 0) {
      await abortMultipart(video.key, video.uploadId);
      await repo.deleteSessionVideo(video.id);
      return json({ ok: true, parts: 0 });
    }

    await completeMultipart(video.key, video.uploadId, parts);
    await repo.completeSessionVideo(video.id);
    return json({ ok: true, parts: parts.length });
  } catch (err) {
    return errorResponse(err);
  }
}
