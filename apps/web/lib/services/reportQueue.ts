import "server-only";
import * as repo from "@/lib/db/repo";
import { settleUnfinishedVideos } from "./videoService";
import { buildAndSaveReport } from "./reportService";

export type BuildOutcome = "built" | "already_built" | "not_claimed" | "failed";

export async function claimAndBuild(
  sessionId: string,
  opts: { videoGraceMs?: number } = {},
): Promise<BuildOutcome> {
  if (await repo.getReportBySession(sessionId)) return "already_built";

  const session = await repo.claimReportLease(sessionId);
  if (!session) return "not_claimed";

  await settleUnfinishedVideos(sessionId, { graceMs: opts.videoGraceMs }).catch((err) => {
    console.warn(`[reportQueue] could not settle videos for ${sessionId}:`, err);
  });

  try {
    await buildAndSaveReport(session);
    await repo.setStatus(sessionId, "completed");
    return "built";
  } catch (err) {
    const message = (err as Error)?.message?.slice(0, 300) ?? "Report build failed.";
    if (session.reportAttempts >= repo.MAX_REPORT_ATTEMPTS) {
      console.error(`[reportQueue] ${sessionId} failed permanently after ${session.reportAttempts} attempts:`, err);
      await repo.setStatus(sessionId, "error", message);
      return "failed";
    }
    console.warn(`[reportQueue] ${sessionId} attempt ${session.reportAttempts} failed; will retry:`, err);
    await repo.releaseReportLease(sessionId).catch(() => {
    });
    return "failed";
  }
}

export async function drainReports(budgetMs: number, max = 25): Promise<BuildOutcome[]> {
  const deadline = Date.now() + budgetMs;
  const outcomes: BuildOutcome[] = [];

  const pending = await repo.listPendingReportSessions(max);
  for (const { id } of pending) {
    if (Date.now() >= deadline) {
      console.warn(`[reportQueue] budget spent with ${pending.length - outcomes.length} still queued`);
      break;
    }
    outcomes.push(await claimAndBuild(id));
  }

  await failStrandedReports();
  return outcomes;
}

async function failStrandedReports(): Promise<void> {
  try {
    const stranded = await repo.listStrandedReportSessions();
    for (const { id } of stranded) {
      await repo.setStatus(
        id,
        "error",
        `Report generation failed after ${repo.MAX_REPORT_ATTEMPTS} attempts.`,
      );
      console.error(`[reportQueue] ${id} stranded out of attempts; failed out`);
    }
  } catch (err) {
    console.error("[reportQueue] could not fail out stranded sessions:", err);
  }
}
