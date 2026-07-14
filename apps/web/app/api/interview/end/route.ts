export const runtime = "nodejs";
// The slow one: acoustic fan-out + a big LLM call. On serverless, mind the
// function duration limit (Grill §Deployment); self-host or a job queue if long.
export const maxDuration = 120;

/**
 * How long a `generating_report` session may sit with no report before we treat
 * the run that set it as dead and allow a retry. Must exceed maxDuration, or we
 * could start a second build while the first is still legitimately running.
 */
const STALE_REPORT_MS = 3 * 60_000;

import type { EndResponse } from "@repo/types";
import { conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { sessionIdSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { buildAndSaveReport } from "@/lib/services/reportService";

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
    // No report, but flagged as generating: either a build is genuinely running,
    // or the one that set this died (serverless timeout) and left the session
    // permanently unfinishable. Give up on it once it outlives maxDuration.
    if (session.status === "generating_report") {
      const stale = Date.now() - session.updatedAt.getTime() > STALE_REPORT_MS;
      if (!stale) {
        throw conflict("Report generation already in progress.", "report_in_progress");
      }
      console.warn(`[end] session ${session_id} stale in generating_report; retrying build`);
    }

    await repo.setStatus(session_id, "generating_report");
    try {
      const report = await buildAndSaveReport(session);
      await repo.setStatus(session_id, "completed");
      return json({ session_id, report_id: report.id, status: "completed" } satisfies EndResponse);
    } catch (err) {
      await repo.setStatus(session_id, "error", (err as Error).message.slice(0, 300));
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
