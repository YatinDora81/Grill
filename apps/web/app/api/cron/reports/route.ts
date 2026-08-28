export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

import { config } from "@/lib/env";
import { json } from "@/lib/http";
import { drainReports } from "@/lib/services/reportQueue";
import { purgeExpiredVideos } from "@/lib/services/videoService";
import { purgeExpiredAudio } from "@/lib/services/audioService";

const DRAIN_BUDGET_MS = 240_000;

export async function GET(req: Request) {
  const secret = config.cron.secret;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set; refusing to sweep");
    return new Response("Not found", { status: 404 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const outcomes = await drainReports(DRAIN_BUDGET_MS);
  const tally = outcomes.reduce<Record<string, number>>((a, o) => ((a[o] = (a[o] ?? 0) + 1), a), {});
  console.log(`[cron] swept ${outcomes.length} session(s):`, tally);

  let purged = 0;
  try {
    purged = await purgeExpiredVideos();
  } catch (err) {
    console.error("[cron] video purge failed:", err);
  }
  let purgedAudio = 0;
  try {
    purgedAudio = await purgeExpiredAudio();
  } catch (err) {
    console.error("[cron] audio purge failed:", err);
  }

  return json({ swept: outcomes.length, purged, purged_audio: purgedAudio, ...tally });
}
