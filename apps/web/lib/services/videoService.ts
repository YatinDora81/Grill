import "server-only";
import * as repo from "@/lib/db/repo";
import {
  abortMultipart,
  completeMultipart,
  deleteObject,
  listParts,
  type UploadedPart,
} from "@/lib/storage/objectStore";

/**
 * How long an upload must lie idle before a caller who might be racing a live
 * browser may settle it.
 *
 * The room fires `video.finish()` without awaiting and calls /end in the same
 * breath, so a settle triggered from there lands while the tail is still being
 * pushed. Anything under a minute risks mistaking that for silence. Being
 * generous costs nothing: an upload genuinely orphaned inside the window is
 * salvaged the moment someone opens the report, which that path already does.
 */
export const VIDEO_FLUSH_GRACE_MS = 120_000;

/**
 * The parts that actually make a video: the run from 1 with no gaps in it.
 *
 * A part that exhausts its retries has already had its number taken, so the
 * sequence R2 ends up holding can have a hole where it should have landed.
 * Stitching across one is worse than dropping the tail — the chunks after a
 * missing chunk have nothing to decode against, so the file plays up to the gap
 * and then breaks, while `completedAt` and the UI both call it finished. Keeping
 * the prefix keeps every second that can actually be watched and discards only
 * what was already unreadable.
 */
function playablePrefix(parts: UploadedPart[]): UploadedPart[] {
  const usable: UploadedPart[] = [];
  for (const [i, p] of parts.entries()) {
    if (p.partNumber !== i + 1) break;
    usable.push(p);
  }
  return usable;
}

/**
 * Might a browser still be feeding this upload?
 *
 * There is no flag for "mid-flush", so the parts are the only evidence: R2
 * stamps each one as it lands, and a part that arrived a moment ago means
 * someone is writing right now.
 *
 * No parts at all counts as writing too, which is the case worth spelling out.
 * An empty upload looks identical whether the camera was denied for the whole
 * interview or the first part is seconds from landing — and the two settle to
 * opposite outcomes, because an upload with nothing in it gets deleted outright.
 * Guessing wrong there destroys the recording, so a caller that admits a live
 * client is possible does not get to guess.
 */
function maybeWriting(parts: { lastModified: number | null }[], graceMs: number): boolean {
  const stamps = parts.map((p) => p.lastModified).filter((t): t is number => t !== null);
  if (!stamps.length) return true;
  return Date.now() - Math.max(...stamps) < graceMs;
}

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
 *
 * `graceMs` is mandatory for any caller that can race a live browser: it leaves
 * an upload alone until nothing has landed on it for that long. Callers who know
 * the writer is gone — a reload replacing the recording, a cancelled session —
 * omit it and settle at once, because for them "no parts yet" really does mean
 * there was never anything to save.
 */
export async function settleUnfinishedVideos(
  sessionId: string,
  opts: { graceMs?: number } = {},
): Promise<void> {
  const orphans = await repo.listUnfinishedVideos(sessionId);
  for (const v of orphans) {
    if (!v.uploadId) continue;
    try {
      const parts = await listParts(v.key, v.uploadId);
      if (opts.graceMs !== undefined && maybeWriting(parts, opts.graceMs)) continue;
      const usable = playablePrefix(parts);
      if (usable.length === 0) {
        // Nothing was ever uploaded, or the very first part is the one missing:
        // either way there is no video here to save.
        await abortMultipart(v.key, v.uploadId);
        await repo.deleteSessionVideo(v.id);
        continue;
      }
      await completeMultipart(v.key, v.uploadId, usable);
      await repo.completeSessionVideo(v.id);
      const lost = parts.length - usable.length;
      console.log(
        `[video] salvaged ${v.id} for session ${sessionId} (${usable.length} parts` +
          `${lost ? `, dropped ${lost} stranded past a gap` : ""})`,
      );
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
