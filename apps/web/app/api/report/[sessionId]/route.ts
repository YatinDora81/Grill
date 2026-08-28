export const runtime = "nodejs";

import type { Report as ReportDTO } from "@repo/types";
import { notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { sessionId } = await params;
    const r = await repo.getReportForUser(sessionId, userId);
    if (!r) throw notFound("No report for that session.", "no_report");

    const out: ReportDTO = {
      id: r.id,
      session_id: r.sessionId,
      overall_score: r.overallScore,
      verdict: r.verdict,
      category_scores: r.categoryScores as unknown as ReportDTO["category_scores"],
      delivery_metrics: r.deliveryMetrics as unknown as ReportDTO["delivery_metrics"],
      strengths: r.strengths as unknown as ReportDTO["strengths"],
      weaknesses: r.weaknesses as unknown as ReportDTO["weaknesses"],
      best_answer: r.bestAnswer as unknown as ReportDTO["best_answer"],
      worst_answer: r.worstAnswer as unknown as ReportDTO["worst_answer"],
      next_steps: r.nextSteps as unknown as ReportDTO["next_steps"],
      question_feedback: (r.questionFeedback as unknown as ReportDTO["question_feedback"]) ?? [],
      star_breakdown: (r.starBreakdown as unknown as ReportDTO["star_breakdown"]) ?? [],
      created_at: r.createdAt.toISOString(),
    };
    return json(out);
  } catch (err) {
    return errorResponse(err);
  }
}
