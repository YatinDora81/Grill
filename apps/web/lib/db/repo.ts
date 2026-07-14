import "server-only";
/**
 * Data access. Thin wrappers over the shared Prisma client (@repo/db).
 * HARD RULE #11: every session/report query filters on the authenticated
 * user_id — a user can only ever touch their own data.
 */
import { prisma, Prisma } from "@repo/db";
import type {
  AnswerScores,
  InterviewConfig,
  QuestionType,
  SessionStatus,
  SourceType,
  TranscriptWord,
} from "@repo/types";

const json = (v: unknown) => v as Prisma.InputJsonValue;

// ── Users ─────────────────────────────────────────────────────────
export function getUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}
export function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}
export function createUser(input: { email: string; passwordHash: string; name?: string | null }) {
  return prisma.user.create({
    data: { email: input.email, passwordHash: input.passwordHash, name: input.name ?? null },
  });
}

export function updateUserName(id: string, name: string | null) {
  return prisma.user.update({ where: { id }, data: { name } });
}

export function updateUserPassword(id: string, passwordHash: string) {
  return prisma.user.update({ where: { id }, data: { passwordHash } });
}

// ── Sessions (always user-scoped) ─────────────────────────────────
export interface CreateSessionInput {
  userId: string;
  sourceType: SourceType;
  sourceText: string;
  role: string | null;
  config: InterviewConfig;
  /** Set to re-run an earlier session on identical questions. */
  retryOfId?: string | null;
}

export function createSession(input: CreateSessionInput) {
  return prisma.session.create({
    data: {
      userId: input.userId,
      sourceType: input.sourceType,
      sourceText: input.sourceText,
      role: input.role,
      config: json(input.config),
      status: "in_progress",
      retryOfId: input.retryOfId ?? null,
    },
  });
}

/**
 * Copy a session's questions into a new one, verbatim and in order.
 *
 * New rows (new ids, no answers) carrying the same text: a retry has to be a
 * separate interview with its own answers and its own report, or there's
 * nothing to compare against. Written in one transaction — a half-copied
 * interview would strand the user on a missing question.
 */
export async function copyQuestionsInto(
  targetSessionId: string,
  sourceSessionId: string,
): Promise<number> {
  const source = await prisma.turn.findMany({
    where: { sessionId: sourceSessionId },
    orderBy: { turnIndex: "asc" },
    select: { turnIndex: true, question: true, questionType: true },
  });
  if (!source.length) return 0;
  const { count } = await prisma.turn.createMany({
    data: source.map((t) => ({
      sessionId: targetSessionId,
      turnIndex: t.turnIndex,
      question: t.question,
      questionType: t.questionType,
    })),
  });
  return count;
}

/** The session this one re-runs, if any — user-scoped like everything else. */
export function getRetryParent(session: { retryOfId: string | null }, userId: string) {
  if (!session.retryOfId) return Promise.resolve(null);
  return prisma.session.findFirst({
    where: { id: session.retryOfId, userId },
    include: { report: true },
  });
}

/** Fetch a session that belongs to this user (null otherwise). */
export function getSession(id: string, userId: string) {
  return prisma.session.findFirst({ where: { id, userId } });
}

export function setStatus(id: string, status: SessionStatus, errorReason: string | null = null) {
  return prisma.session.update({ where: { id }, data: { status, errorReason } });
}

export function getTurns(sessionId: string) {
  return prisma.turn.findMany({ where: { sessionId }, orderBy: { turnIndex: "asc" } });
}

export function getTurn(sessionId: string, turnIndex: number) {
  return prisma.turn.findUnique({ where: { sessionId_turnIndex: { sessionId, turnIndex } } });
}

export interface CreateTurnInput {
  sessionId: string;
  turnIndex: number;
  question: string;
  questionType: QuestionType;
  audioKey?: string | null;
  transcript?: string | null;
  transcriptWords?: TranscriptWord[] | null;
  answerScores?: AnswerScores | null;
}

export function createTurn(input: CreateTurnInput) {
  return prisma.turn.create({
    data: {
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      question: input.question,
      questionType: input.questionType,
      audioKey: input.audioKey ?? null,
      transcript: input.transcript ?? null,
      transcriptWords: input.transcriptWords ? json(input.transcriptWords) : Prisma.JsonNull,
      answerScores: input.answerScores ? json(input.answerScores) : Prisma.JsonNull,
    },
  });
}

export function recordAnswer(
  sessionId: string,
  turnIndex: number,
  data: {
    audioKey?: string | null;
    transcript: string;
    transcriptWords?: TranscriptWord[] | null;
    answerScores: AnswerScores;
  },
) {
  return prisma.turn.update({
    where: { sessionId_turnIndex: { sessionId, turnIndex } },
    data: {
      audioKey: data.audioKey ?? undefined,
      transcript: data.transcript,
      transcriptWords: data.transcriptWords ? json(data.transcriptWords) : undefined,
      answerScores: json(data.answerScores),
    },
  });
}

// ── Reports ───────────────────────────────────────────────────────
export interface CreateReportInput {
  sessionId: string;
  overallScore: number;
  verdict: string;
  categoryScores: unknown;
  deliveryMetrics: unknown;
  strengths: unknown;
  weaknesses: unknown;
  bestAnswer: unknown;
  worstAnswer: unknown;
  nextSteps: unknown;
  raw: unknown;
}

/**
 * Upsert, not create: `Report.sessionId` is @unique, and /end can legitimately
 * re-run for a session (interrupted report build, stale-status retry). A plain
 * create would throw P2002 on the second pass and strand the session.
 */
export function createReport(input: CreateReportInput) {
  const fields = {
    overallScore: input.overallScore,
    verdict: input.verdict,
    categoryScores: json(input.categoryScores),
    deliveryMetrics: json(input.deliveryMetrics),
    strengths: json(input.strengths),
    weaknesses: json(input.weaknesses),
    bestAnswer: input.bestAnswer ? json(input.bestAnswer) : Prisma.JsonNull,
    worstAnswer: input.worstAnswer ? json(input.worstAnswer) : Prisma.JsonNull,
    nextSteps: json(input.nextSteps),
    raw: json(input.raw),
  };
  return prisma.report.upsert({
    where: { sessionId: input.sessionId },
    create: { sessionId: input.sessionId, ...fields },
    update: fields,
  });
}

export function getReportBySession(sessionId: string) {
  return prisma.report.findUnique({ where: { sessionId } });
}

/** Report for a session, only if the session belongs to this user. */
export async function getReportForUser(sessionId: string, userId: string) {
  const session = await getSession(sessionId, userId);
  if (!session) return null;
  return getReportBySession(sessionId);
}

// ── Dashboard (user-scoped) ───────────────────────────────────────
/**
 * Every question this user has already been asked, newest first. Feeds the
 * do-not-reuse list when "repeat questions" is off.
 *
 * Capped: someone practising weekly racks up hundreds of questions, and the
 * whole list would be pasted into every prompt — that's real tokens on every
 * turn, for questions they last saw months ago. The recent ones are the ones
 * they'd actually notice repeating.
 */
export async function listAskedQuestions(userId: string, take = 60): Promise<string[]> {
  const turns = await prisma.turn.findMany({
    where: { session: { userId } },
    orderBy: { createdAt: "desc" },
    take,
    select: { question: true },
  });
  return [...new Set(turns.map((t) => t.question))];
}

export interface WeakTurn {
  question: string;
  questionType: QuestionType;
  transcript: string;
  scores: AnswerScores;
}

/**
 * Answered turns this user scored worst on — the raw material for `weak_spots`.
 * Only turns with both a transcript and scores can be judged, and scoring is
 * done here rather than in SQL because answer_scores is a JSON blob.
 */
export async function listWeakTurns(userId: string, take = 8): Promise<WeakTurn[]> {
  const turns = await prisma.turn.findMany({
    where: { session: { userId }, transcript: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 120,
    select: { question: true, questionType: true, transcript: true, answerScores: true },
  });

  const scored = turns.flatMap((t) => {
    // answer_scores is an opaque JSON column, so nothing about its shape is
    // guaranteed at this boundary — an unscored or half-written turn just
    // drops out rather than poisoning the ranking with NaN.
    const s = t.answerScores as unknown as AnswerScores | null;
    if (!s || typeof s.relevance !== "number") return [];
    // Mean of the rubric. `filler` is already "higher is better" in the rubric,
    // so it needs no inversion here.
    const mean =
      (s.relevance + s.correctness + s.structure + s.depth + s.filler) / 5;
    return [{ turn: t, mean }];
  });

  return scored
    .sort((a, b) => a.mean - b.mean)
    .slice(0, take)
    .map(({ turn }) => ({
      question: turn.question,
      questionType: turn.questionType,
      transcript: turn.transcript ?? "",
      scores: turn.answerScores as unknown as AnswerScores,
    }));
}

export function listUserSessions(userId: string, take = 10) {
  return prisma.session.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    include: { report: { select: { overallScore: true } } },
  });
}

export function listUserReports(userId: string) {
  return prisma.report.findMany({
    where: { session: { userId } },
    orderBy: { createdAt: "asc" },
    select: { overallScore: true, createdAt: true },
  });
}
