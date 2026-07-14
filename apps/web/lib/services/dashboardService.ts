import "server-only";
import type { DashboardData, RecentSession } from "@repo/types";
import { notFound } from "@/lib/errors";
import * as repo from "@/lib/db/repo";
import { toUserDTO } from "@/lib/auth";

/** Assemble the user's dashboard data (all queries scoped to userId). */
export async function getDashboardData(userId: string): Promise<DashboardData> {
  const [user, reports, sessions] = await Promise.all([
    repo.getUserById(userId),
    repo.listUserReports(userId),
    repo.listUserSessions(userId, 10),
  ]);
  if (!user) throw notFound("User not found.", "unknown_user");

  const scores = reports.map((r) => r.overallScore);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const best = scores.length ? Math.max(...scores) : null;
  const last = scores.length ? scores[scores.length - 1]! : null;

  const recent: RecentSession[] = sessions.map((s) => ({
    session_id: s.id,
    date: s.createdAt.toISOString().slice(0, 10),
    role: s.role,
    score: s.report?.overallScore ?? null,
    status: s.status,
  }));

  return {
    user: toUserDTO(user),
    stats: {
      completed: reports.length,
      avg_score: avg,
      best_score: best,
      last_score: last,
      trend: scores.slice(-12),
    },
    recent,
  };
}
