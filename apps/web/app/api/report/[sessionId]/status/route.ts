export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { SessionStatus } from "@repo/types";
import { notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";

export interface ReportStatusResponse {
  session_id: string;
  status: SessionStatus;
  ready: boolean;
  error_reason: string | null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const userId = await requireUserId();
    const { sessionId } = await params;

    const session = await repo.getSession(sessionId, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");

    const report = await repo.getReportBySession(sessionId);

    return json({
      session_id: sessionId,
      status: session.status,
      ready: Boolean(report),
      error_reason: session.status === "error" ? session.errorReason : null,
    } satisfies ReportStatusResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
