import "server-only";
import * as repo from "@/lib/db/repo";
import { config } from "@/lib/env";
import { audioPrefix, deleteObject, listObjects } from "@/lib/storage/objectStore";

/**
 * Delete answer audio past its retention (default 100 days, matching video).
 *
 * Driven by R2, not by the `audioKey` columns. Those name only the clips whose
 * turn was scored successfully — an answer that died between the upload and the
 * scoring leaves an object no row has ever referenced, and a column-driven
 * sweep would walk straight past it and keep it forever. Listing the session's
 * prefix reaps the orphans and the good clips in the same pass.
 *
 * Deleting the audio does NOT delete the interview: the transcript, the scores
 * and the report are the substance and they stay. This only removes the voice,
 * the same way purgeExpiredVideos only removes the picture.
 *
 * Object first, marker second — the same order, and the same reasoning, as the
 * video purge: a crash between the two re-lists the session tomorrow and
 * deletes whatever is left (deleteObject treats a 404 as success), which is
 * cheap. The other order would drop the only pointer to live objects.
 */
export async function purgeExpiredAudio(limit = 100): Promise<number> {
  if (!config.storageConfigured) return 0;

  const cutoff = new Date(Date.now() - config.audio.retentionDays * 24 * 60 * 60 * 1000);
  const sessions = await repo.listSessionsWithExpiredAudio(cutoff, limit);
  let purged = 0;

  for (const s of sessions) {
    try {
      for (const key of await listObjects(audioPrefix(s.id))) {
        await deleteObject(key);
      }
      // Also marks sessions that never had audio (every answer typed, or the
      // clips were already purged by hand). There is nothing to delete there,
      // but the marker is what stops us re-listing them every night.
      await repo.markAudioPurged(s.id);
      purged++;
    } catch (err) {
      // One unreachable key must not strand the rest of the backlog: leave this
      // session unmarked and it comes back round tomorrow.
      console.warn(`[audio] could not purge session ${s.id}:`, err);
    }
  }

  if (purged) console.log(`[audio] purged audio for ${purged} expired session(s)`);
  return purged;
}
