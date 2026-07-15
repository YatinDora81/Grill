import "server-only";
import * as repo from "@/lib/db/repo";
import { settleUnfinishedVideos } from "./videoService";
import { buildAndSaveReport } from "./reportService";

/**
 * The report queue.
 *
 * A session with status `generating_report` and no report row is queued. There
 * is no jobs table: the queue is a predicate over sessions, which is why a hard
 * crash loses nothing — the row still matches, so the next pass finds it. That
 * is the "we did not change anything until the report is generated" property,
 * with one deliberate exception: `reportAttempts` increments on claim, because
 * a session that always throws would otherwise be retried forever and sit at the
 * head of the queue blocking everyone behind it.
 *
 * Building is triggered two ways:
 *  - `after()` on /end, which fires the moment the last answer lands. This is
 *    the path that actually runs for real users — reports are ready in ~30s.
 *  - the daily cron sweep, which is only a backstop for builds that crashed or
 *    exhausted their key rotation. (Vercel Hobby caps cron at once per day; a
 *    sub-daily expression fails at deploy. On Pro, drop it to * * * * *.)
 */

export type BuildOutcome = "built" | "already_built" | "not_claimed" | "failed";

/**
 * Claim one session and build its report.
 *
 * Safe to call concurrently with itself and with the sweep: whoever loses the
 * claim returns `not_claimed` and does nothing.
 */
export async function claimAndBuild(sessionId: string): Promise<BuildOutcome> {
  // Cheap pre-check. The claim below is what actually decides — this only
  // avoids burning an attempt on a session that's already finished.
  if (await repo.getReportBySession(sessionId)) return "already_built";

  const session = await repo.claimReportLease(sessionId);
  if (!session) return "not_claimed";

  // The interview is over, and this is the only "over" that runs server-side.
  // The client's own /video/complete is best-effort — the tab can be closed or
  // navigated away while the tail is still flushing, and then nothing ever
  // stitches the parts: /video/start and /cancel are the other settle callers
  // and a finished session reaches neither. Without this, a recording whose
  // upload outlived its tab dangles until R2 reaps it.
  //
  // Before the build, not after: the build is the part that can throw and
  // burn the session's attempts, and the footage must not be hostage to it.
  await settleUnfinishedVideos(sessionId).catch((err) => {
    /* best-effort by contract — a report must never fail over housekeeping */
    console.warn(`[reportQueue] could not settle videos for ${sessionId}:`, err);
  });

  try {
    await buildAndSaveReport(session);
    await repo.setStatus(sessionId, "completed");
    return "built";
  } catch (err) {
    const message = (err as Error)?.message?.slice(0, 300) ?? "Report build failed.";
    // Out of attempts: stop retrying and say so, rather than leaving the user
    // staring at a spinner that will never resolve.
    if (session.reportAttempts >= repo.MAX_REPORT_ATTEMPTS) {
      console.error(`[reportQueue] ${sessionId} failed permanently after ${session.reportAttempts} attempts:`, err);
      await repo.setStatus(sessionId, "error", message);
      return "failed";
    }
    // Retryable: drop the lease so the next pass can take it immediately, and
    // leave the status alone — status IS queue membership.
    console.warn(`[reportQueue] ${sessionId} attempt ${session.reportAttempts} failed; will retry:`, err);
    await repo.releaseReportLease(sessionId).catch(() => {
      /* lease expires on its own; losing this race costs a few minutes, not the report */
    });
    return "failed";
  }
}

/**
 * Work the queue until it's empty or the budget runs out.
 *
 * Strictly one at a time, and each session is re-claimed as it comes up rather
 * than the batch being claimed up front — so a run that dies halfway leaves
 * everything it hadn't started completely untouched.
 *
 * The budget exists because this runs inside a function with a hard duration
 * ceiling: stopping early leaves the rest queued, which is exactly what the next
 * sweep is for. It never re-fetches rows it is still working on — the lease
 * takes them out of `listPendingReportSessions` the moment they're claimed.
 */
export async function drainReports(budgetMs: number, max = 25): Promise<BuildOutcome[]> {
  const deadline = Date.now() + budgetMs;
  const outcomes: BuildOutcome[] = [];

  const pending = await repo.listPendingReportSessions(max);
  for (const { id } of pending) {
    // One build can take minutes; starting another with seconds left just gets
    // it killed mid-flight and burns an attempt for nothing.
    if (Date.now() >= deadline) {
      console.warn(`[reportQueue] budget spent with ${pending.length - outcomes.length} still queued`);
      break;
    }
    outcomes.push(await claimAndBuild(id));
  }
  return outcomes;
}
