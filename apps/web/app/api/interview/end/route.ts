export const runtime = "nodejs";
export const maxDuration = 300;

import { after } from "next/server";
import type { EndResponse } from "@repo/types";
import { conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { sessionIdSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { publishReportBuild, qstashConfigured } from "@/lib/queue/qstash";
import { claimAndBuild } from "@/lib/services/reportQueue";
import { VIDEO_FLUSH_GRACE_MS } from "@/lib/services/videoService";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { session_id } = sessionIdSchema.parse(await req.json());
    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");

    const existing = await repo.getReportBySession(session_id);
    if (existing) {
      if (session.status !== "completed") await repo.setStatus(session_id, "completed");
      return json({ session_id, report_id: existing.id, status: "completed" } satisfies EndResponse);
    }

    if (session.status === "cancelled") {
      throw conflict("Session was cancelled.", "session_cancelled");
    }

    if (session.reportAttempts >= repo.MAX_REPORT_ATTEMPTS) {
      throw conflict("Report generation failed for this session.", "report_failed");
    }

    if (session.status !== "generating_report") {
      await repo.setStatus(session_id, "generating_report");
    }

    const buildInline = async () => {
      try {
        await claimAndBuild(session_id, { videoGraceMs: VIDEO_FLUSH_GRACE_MS });
      } catch (err) {
        console.error(`[end] background build for ${session_id} threw:`, err);
      }
    };

    if (qstashConfigured()) {
      await publishReportBuild(session_id).catch((err) => {
        console.error("[end] qstash publish failed; falling back to after():", err);
        after(buildInline);
      });
    } else {
      after(buildInline);
    }

    return json({
      session_id,
      report_id: null,
      status: "generating_report",
    } satisfies EndResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
