import "server-only";
import type {
  AnswerScores,
  DashboardData,
  DeliveryMetrics,
  DeliveryPoint,
  InterviewConfig,
  RecentSession,
  RetryChainHop,
} from "@repo/types";
import { notFound } from "@/lib/errors";
import * as repo from "@/lib/db/repo";
import { toUserDTO } from "@/lib/auth";
import { drillStats } from "@/lib/services/drillService";
import { PATTERN, worstDimension } from "@/lib/rubricPattern";

const WEEK_MS = 7 * 864e5;

const PATTERN_MIN_SESSIONS = 3;

function derivePattern(scores: AnswerScores[], sessionCount: number): string | null {
  if (sessionCount < PATTERN_MIN_SESSIONS || scores.length === 0) return null;
  const worst = worstDimension(scores);
  return worst === null ? null : PATTERN[worst];
}

function fillerCount(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const n = (raw as Partial<DeliveryMetrics>).filler_count;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function wordsPerMinute(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const n = (raw as Partial<DeliveryMetrics>).wpm;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

function plannedQuestions(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const n = (raw as Partial<InterviewConfig>).num_questions;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const [user, reports, sessions] = await Promise.all([
    repo.getUserById(userId),
    repo.listUserReportsWithDelivery(userId),
    repo.listUserSessions(userId, 10),
  ]);
  if (!user) throw notFound("User not found.", "unknown_user");

  const scores = reports.map((r) => r.overallScore);
  const last = scores.length ? scores[scores.length - 1]! : null;
  const first = scores.length ? scores[0]! : null;

  const weekAgo = Date.now() - WEEK_MS;
  const sessionsThisWeek = reports.filter((r) => r.session.createdAt.getTime() >= weekAgo).length;

  const newest = reports[reports.length - 1] ?? null;
  const oldest = reports[0] ?? null;

  const countable = [...new Set([newest?.sessionId, oldest?.sessionId].filter(Boolean))] as string[];

  const unfinished = sessions.find((s) => s.status === "in_progress") ?? null;
  const rematch = sessions.find((s) => s.retryOfId !== null) ?? null;

  const [counts, rubric, progress, chainRows, drill] = await Promise.all([
    Promise.all(countable.map((id) => repo.countAnsweredTurns(userId, id))),
    reports.length >= PATTERN_MIN_SESSIONS
      ? repo.listRecentAnswerScores(userId)
      : Promise.resolve([] as AnswerScores[]),
    unfinished ? repo.getSessionProgress(userId, unfinished.id) : Promise.resolve(null),
    rematch
      ? repo.listRetryChain(rematch.id, userId)
      : Promise.resolve([] as repo.RetryChainSession[]),
    drillStats(userId, user.timezone),
  ]);
  const answered = new Map(countable.map((id, i) => [id, counts[i]!]));

  const perAnswer = (report: (typeof reports)[number] | null): number | null => {
    if (!report) return null;
    const fillers = fillerCount(report.deliveryMetrics);
    const turns = answered.get(report.sessionId) ?? 0;
    if (fillers === null || turns === 0) return null;
    return Math.round((fillers / turns) * 10) / 10;
  };

  const deliverySeries: DeliveryPoint[] = reports.map((r) => ({
    session_id: r.sessionId,
    date: r.session.createdAt.toISOString().slice(0, 10),
    wpm: wordsPerMinute(r.deliveryMetrics),
    fillers: fillerCount(r.deliveryMetrics),
  }));

  const hops: RetryChainHop[] = [];
  for (const row of chainRows) {
    if (row.overallScore === null) continue;
    hops.push({
      session_id: row.id,
      name: row.name,
      overall_score: row.overallScore,
      date: row.createdAt.toISOString().slice(0, 10),
    });
  }

  const recent: RecentSession[] = sessions.map((s) => ({
    session_id: s.id,
    date: s.createdAt.toISOString().slice(0, 10),
    name: s.name,
    role: s.role,
    score: s.report?.overallScore ?? null,
    status: s.status,
    progress:
      progress && s.id === unfinished?.id
        ? {
            answered: progress._count.turns,
            total: plannedQuestions(progress.config),
            last_activity: (progress.turns[0]?.createdAt ?? s.createdAt).toISOString(),
          }
        : null,
  }));

  return {
    user: toUserDTO(user),
    stats: {
      completed: reports.length,
      last_score: last,
      trend: scores,
      first_score: first,
      sessions_this_week: sessionsThisWeek,
      fillers_per_answer: perAnswer(newest),
      fillers_per_answer_first: perAnswer(oldest),
      top_pattern: derivePattern(rubric, reports.length),
      streak_days: drill.streak_days,
      cards_due: drill.cards_due,
    },
    recent,
    delivery_series: deliverySeries,
    retry_chain:
      hops.length >= 2
        ? { name: chainRows.find((r) => r.name !== null)?.name ?? null, hops }
        : null,
  };
}
