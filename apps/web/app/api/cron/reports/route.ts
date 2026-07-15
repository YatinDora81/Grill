export const runtime = "nodejs";
export const maxDuration = 300;
// A sweep must never be served from cache — a cached "swept" is a sweep that
// never ran.
export const dynamic = "force-dynamic";

import { config } from "@/lib/env";
import { json } from "@/lib/http";
import { drainReports } from "@/lib/services/reportQueue";
import { purgeExpiredVideos } from "@/lib/services/videoService";
import { purgeExpiredAudio } from "@/lib/services/audioService";

/** Leave room for the retention purge and the response; the ceiling is 300s. */
const DRAIN_BUDGET_MS = 240_000;

/**
 * Backstop sweep for reports whose build died or exhausted its retries.
 *
 * NOT the main path — `after()` on /end builds every report the moment the
 * interview ends. This exists for the cases that path can't cover: the function
 * was killed mid-build, every API key failed, or the provider was down. On
 * Vercel Hobby cron can only run once per day (a sub-daily expression fails at
 * deploy time), so on Hobby a failed report waits for tomorrow — or for the
 * candidate to open the report page, which re-kicks it.
 *
 * Auth: Vercel signs cron requests with CRON_SECRET as a bearer token. Without
 * this check the route is an unauthenticated way to make a stranger's LLM bill
 * arbitrarily large. If no secret is configured the route refuses to run at all
 * rather than defaulting open.
 */
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

  // Retention rides along rather than taking a cron slot of its own: Hobby only
  // allows one run per day, and 100-day expiry does not need better than daily.
  // Never allowed to fail the sweep — a purge error must not look like reports
  // failing to build. Audio and video are caught separately so a broken one
  // doesn't take the working one down with it.
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
