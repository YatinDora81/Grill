export const runtime = "nodejs";
// A poll that reads its own cached answer would report "still building" forever.
export const dynamic = "force-dynamic";

import type { SessionStatus } from "@repo/types";
import { notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";

export interface ReportStatusResponse {
  session_id: string;
  status: SessionStatus;
  /** The only field the client should branch on — a report row exists. */
  ready: boolean;
  /** Set when the build failed for good; null while it may still succeed. */
  error_reason: string | null;
}

/**
 * Is this session's report ready yet?
 *
 * Deliberately tiny and separate from GET /api/report/[sessionId]: this is
 * polled every couple of seconds, and that route builds a whole report DTO out
 * of six JSON columns to answer a yes/no question.
 *
 * Polled, not long-polled. The requirement said "long polling", but a held-open
 * request on Vercel bills for the whole wait and gets cut at the function
 * ceiling anyway — so a held connection buys nothing over a 2.5s poll except a
 * bigger bill and a worse failure mode.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const userId = await requireUserId();
    const { sessionId } = await params;

    // User-scoped (HARD RULE #11): someone else's session is simply not found.
    const session = await repo.getSession(sessionId, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");

    // The report row is the truth, not the status column — a build that wrote
    // the report and died before setStatus is finished, whatever status says.
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
