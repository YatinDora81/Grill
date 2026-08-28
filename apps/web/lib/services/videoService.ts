import "server-only";
import * as repo from "@/lib/db/repo";
import {
  abortMultipart,
  completeMultipart,
  deleteObject,
  listParts,
  type UploadedPart,
} from "@/lib/storage/objectStore";

export const VIDEO_FLUSH_GRACE_MS = 120_000;

function playablePrefix(parts: UploadedPart[]): UploadedPart[] {
  const usable: UploadedPart[] = [];
  for (const [i, p] of parts.entries()) {
    if (p.partNumber !== i + 1) break;
    usable.push(p);
  }
  return usable;
}

function maybeWriting(parts: { lastModified: number | null }[], graceMs: number): boolean {
  const stamps = parts.map((p) => p.lastModified).filter((t): t is number => t !== null);
  if (!stamps.length) return true;
  return Date.now() - Math.max(...stamps) < graceMs;
}

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

export async function purgeExpiredVideos(limit = 100): Promise<number> {
  const expired = await repo.listExpiredVideos(limit);
  let purged = 0;

  for (const v of expired) {
    try {
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
