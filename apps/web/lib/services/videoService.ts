import "server-only";
import * as repo from "@/lib/db/repo";
import {
  abortMultipart,
  completeMultipart,
  deleteObject,
  listParts,
} from "@/lib/storage/objectStore";

/**
 * Settle a recording whose upload never finished.
 *
 * A tab that dies mid-interview leaves an open multipart upload and a row with
 * no completedAt. R2 reaps abandoned uploads on its own, so the parts already
 * safely in R2 would silently evaporate — this rescues them instead: if any
 * parts landed, complete the upload and keep what was recorded up to the
 * moment the tab died. Only a recording with literally nothing in it is thrown
 * away.
 *
 * Best-effort by contract. Every caller is doing something more important
 * (starting an interview, cancelling one) and none of them may fail because a
 * dead upload couldn't be tidied.
 */
export async function settleUnfinishedVideos(sessionId: string): Promise<void> {
  const orphans = await repo.listUnfinishedVideos(sessionId);
  for (const v of orphans) {
    if (!v.uploadId) continue;
    try {
      const parts = await listParts(v.key, v.uploadId);
      if (parts.length === 0) {
        // Nothing was ever uploaded: there is no video here to save.
        await abortMultipart(v.key, v.uploadId);
        await repo.deleteSessionVideo(v.id);
        continue;
      }
      await completeMultipart(v.key, v.uploadId, parts);
      await repo.completeSessionVideo(v.id);
      console.log(`[video] salvaged ${v.id} for session ${sessionId} (${parts.length} parts)`);
    } catch (err) {
      console.warn(`[video] could not settle ${v.id}:`, err);
    }
  }
}

/**
 * Delete recordings past their 100-day retention.
 *
 * The object goes and the row goes with it; the answers, transcripts and scores
 * do not. Turn.videoId is `onDelete: SetNull` precisely so this can run without
 * taking an interview's substance with the picture.
 *
 * Object first, row second. That order can leave a row pointing at an object
 * that's already gone, which the next pass simply deletes again (deleteObject
 * treats a 404 as success). The other order would leak the object forever with
 * nothing left in the DB to name it.
 */
export async function purgeExpiredVideos(limit = 100): Promise<number> {
  const expired = await repo.listExpiredVideos(limit);
  let purged = 0;

  for (const v of expired) {
    try {
      // Still uploading when it expired: there's no completed object, just parts.
      if (v.uploadId && !v.completedAt) {
        await abortMultipart(v.key, v.uploadId).catch(() => {});
      } else {
        await deleteObject(v.key);
      }
      await repo.deleteSessionVideo(v.id);
      purged++;
    } catch (err) {
      console.warn(`[video] could not purge ${v.id}:`, err);
    }
  }
  if (purged) console.log(`[video] purged ${purged} expired recording(s)`);
  return purged;
}
