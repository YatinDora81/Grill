import "server-only";
import * as repo from "@/lib/db/repo";
import { config } from "@/lib/env";
import { audioPrefix, deleteObject, listObjects } from "@/lib/storage/objectStore";

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
      await repo.markAudioPurged(s.id);
      purged++;
    } catch (err) {
      console.warn(`[audio] could not purge session ${s.id}:`, err);
    }
  }

  if (purged) console.log(`[audio] purged audio for ${purged} expired session(s)`);
  return purged;
}
