export const runtime = "nodejs";
// The response is instant now, but `after()` work runs inside this same
// invocation and counts against the ceiling — so the build's whole budget is
// this number. 300s is the Vercel maximum on Hobby (and the default on Pro).
export const maxDuration = 300;

import { after } from "next/server";
import type { EndResponse } from "@repo/types";
import { conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { sessionIdSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { claimAndBuild } from "@/lib/services/reportQueue";
import { VIDEO_FLUSH_GRACE_MS } from "@/lib/services/videoService";


/**
 * Finish an interview: queue its report and return immediately.
 *
 * This used to build the report inline and hold the request open for 30-120s.
 * Now it only enqueues (status → `generating_report`) and kicks the build off
 * via `after()`, which runs once the response is already on its way — so the
 * candidate lands on the thank-you screen at once and the report builds behind
 * them. If this invocation dies, the session is still queued and the daily
 * sweep picks it up.
 *
 * The client still calls this on `done`, deliberately. `processAnswer` has TWO
 * `done: true` exits — the second is a retry whose parent had fewer questions
 * than num_questions, and it never satisfies `answered >= num_questions`. A
 * server-side enqueue keyed on that count would strand exactly those retries in
 * `in_progress` forever. Letting the client tell us it's done covers both exits.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { session_id } = sessionIdSchema.parse(await req.json());
    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");

    // The report itself is the source of truth for "done", not the status
    // column. If one exists the work is finished, whatever the status says —
    // reconcile a session left mid-flight (e.g. killed between the report write
    // and setStatus) instead of stranding it.
    const existing = await repo.getReportBySession(session_id);
    if (existing) {
      if (session.status !== "completed") await repo.setStatus(session_id, "completed");
      return json({ session_id, report_id: existing.id, status: "completed" } satisfies EndResponse);
    }

    if (session.status === "cancelled") {
      throw conflict("Session was cancelled.", "session_cancelled");
    }

    // Re-queuing a session whose attempts are spent is worse than refusing it:
    // `setStatus` would clear `errorReason` and promise a report, while
    // `claimReportLease` — which requires `attempts < MAX` — would never take it
    // again. The candidate would trade a stated failure for a spinner that
    // outlives them. /interview/retry is how a failed interview is run again.
    // (The early return above already proved there is no report to serve.)
    if (session.reportAttempts >= repo.MAX_REPORT_ATTEMPTS) {
      throw conflict("Report generation failed for this session.", "report_failed");
    }

    // Enqueue. Idempotent: already-queued sessions just get re-kicked, which the
    // lease makes harmless — a second builder can't claim what the first holds.
    if (session.status !== "generating_report") {
      await repo.setStatus(session_id, "generating_report");
    }

    // Runs after the response flushes, inside this invocation's budget. Errors
    // are swallowed on purpose: the queue is the retry mechanism, and there is
    // no client left listening by the time this runs.
    after(async () => {
      try {
        await claimAndBuild(session_id, { videoGraceMs: VIDEO_FLUSH_GRACE_MS });
      } catch (err) {
        console.error(`[end] background build for ${session_id} threw:`, err);
      }
    });

    return json({
      session_id,
      report_id: null,
      status: "generating_report",
    } satisfies EndResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
