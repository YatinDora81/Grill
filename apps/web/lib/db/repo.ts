import "server-only";
import { createHash } from "node:crypto";
import { prisma, Prisma } from "@repo/db";
import type { Session } from "@repo/db";
import type {
  AnswerScores,
  CameraTurnMetrics,
  InterviewConfig,
  QuestionSetSource,
  QuestionType,
  SessionStatus,
  SourceType,
  TranscriptWord,
} from "@repo/types";

const json = (v: unknown) => v as Prisma.InputJsonValue;

const aliveSession = { deletedAt: null } as const;

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

export function updateUserProfile(
  id: string,
  patch: {
    name?: string | null;
    emailOnReport?: boolean;
    timezone?: string | null;
    emailDigest?: boolean;
  },
) {
  return prisma.user.update({
    where: { id },
    data: {
      name: patch.name,
      emailOnReport: patch.emailOnReport,
      timezone: patch.timezone,
      emailDigest: patch.emailDigest,
    },
  });
}

export function updateUserPassword(id: string, passwordHash: string) {
  return prisma.user.update({ where: { id }, data: { passwordHash } });
}

export interface CreateSessionInput {
  userId: string;
  sourceType: SourceType;
  sourceText: string;
  name: string;
  role: string | null;
  config: InterviewConfig;
  retryOfId?: string | null;
  questionSetId?: string | null;
}

export function createSession(input: CreateSessionInput) {
  return prisma.session.create({
    data: {
      userId: input.userId,
      sourceType: input.sourceType,
      sourceText: input.sourceText,
      name: input.name,
      role: input.role,
      config: json(input.config),
      status: "in_progress",
      retryOfId: input.retryOfId ?? null,
      questionSetId: input.questionSetId ?? null,
    },
  });
}

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

export function getRetryParent(session: { retryOfId: string | null }, userId: string) {
  if (!session.retryOfId) return Promise.resolve(null);
  return prisma.session.findFirst({
    where: { id: session.retryOfId, userId, ...aliveSession },
    include: { report: true },
  });
}

export const MAX_RETRY_CHAIN_HOPS = 10;

export interface RetryChainSession {
  id: string;
  name: string | null;
  overallScore: number | null;
  createdAt: Date;
}

export async function listRetryChain(
  sessionId: string,
  userId: string,
): Promise<RetryChainSession[]> {
  const chain: RetryChainSession[] = [];
  const seen = new Set<string>();
  let cursor: string | null = sessionId;

  while (cursor !== null && chain.length < MAX_RETRY_CHAIN_HOPS && !seen.has(cursor)) {
    const id: string = cursor;
    seen.add(id);
    const row = await prisma.session.findFirst({
      where: { id, userId, ...aliveSession },
      select: {
        id: true,
        name: true,
        createdAt: true,
        retryOfId: true,
        report: { select: { overallScore: true } },
      },
    });
    if (!row) break;
    chain.push({
      id: row.id,
      name: row.name,
      overallScore: row.report?.overallScore ?? null,
      createdAt: row.createdAt,
    });
    cursor = row.retryOfId;
  }

  return chain.reverse();
}

export interface SessionRetries {
  count: number;
  latest: RetryChainSession;
}

export async function getRetriesOf(
  sessionId: string,
  userId: string,
): Promise<SessionRetries | null> {
  const rows = await prisma.session.findMany({
    where: { retryOfId: sessionId, userId, ...aliveSession },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      report: { select: { overallScore: true } },
    },
  });

  const newest = rows[0];
  if (!newest) return null;

  return {
    count: rows.length,
    latest: {
      id: newest.id,
      name: newest.name,
      overallScore: newest.report?.overallScore ?? null,
      createdAt: newest.createdAt,
    },
  };
}

export function getSession(id: string, userId: string) {
  return prisma.session.findFirst({ where: { id, userId, ...aliveSession } });
}

export async function softDeleteSession(id: string, userId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.session.updateMany({
      where: { id, userId, ...aliveSession },
      data: { deletedAt: new Date() },
    });
    if (count !== 1) return false;

    const turns = await tx.turn.findMany({
      where: { sessionId: id },
      select: { id: true },
    });
    if (turns.length) {
      await tx.starredQuestion.updateMany({
        where: { turnId: { in: turns.map((t) => t.id) } },
        data: { turnId: null },
      });
    }
    return true;
  });
}

export function setStatus(id: string, status: SessionStatus, errorReason: string | null = null) {
  return prisma.session.update({ where: { id }, data: { status, errorReason } });
}

export function questionHash(question: string): string {
  const normalized = question.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}

export function starQuestion(userId: string, turn: { id: string; question: string; questionType: QuestionType }) {
  const hash = questionHash(turn.question);
  return prisma.starredQuestion.upsert({
    where: { userId_questionHash: { userId, questionHash: hash } },
    create: {
      userId,
      turnId: turn.id,
      question: turn.question,
      questionType: turn.questionType,
      questionHash: hash,
    },
    update: {},
  });
}

export function unstarQuestion(userId: string, hash: string) {
  return prisma.starredQuestion.deleteMany({ where: { userId, questionHash: hash } });
}

export async function listStarredQuestions(userId: string) {
  const rows = await prisma.starredQuestion.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      turn: {
        select: {
          sessionId: true,
          turnIndex: true,
          session: { select: { deletedAt: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    question: r.question,
    questionType: r.questionType,
    questionHash: r.questionHash,
    turnId: r.turnId,
    createdAt: r.createdAt,
    turn:
      r.turn && r.turn.session.deletedAt === null
        ? { sessionId: r.turn.sessionId, turnIndex: r.turn.turnIndex }
        : null,
  }));
}

export async function starredHashesFor(userId: string, questions: string[]): Promise<Set<string>> {
  const hashes = questions.map(questionHash);
  const rows = await prisma.starredQuestion.findMany({
    where: { userId, questionHash: { in: hashes } },
    select: { questionHash: true },
  });
  return new Set(rows.map((r) => r.questionHash));
}

export function getTurnForUser(turnId: string, userId: string) {
  return prisma.turn.findFirst({
    where: { id: turnId, session: { userId, ...aliveSession } },
    select: { id: true, question: true, questionType: true },
  });
}

const aliveSet = { deletedAt: null } as const;

export interface CreateQuestionSetInput {
  userId: string;
  name: string;
  source: QuestionSetSource;
  sourceText: string;
  role: string | null;
  difficulty: string;
  items: { question: string; questionType: QuestionType }[];
}

export function createQuestionSetWithItems(input: CreateQuestionSetInput) {
  return prisma.$transaction(async (tx) => {
    const set = await tx.questionSet.create({
      data: {
        userId: input.userId,
        name: input.name,
        source: input.source,
        sourceText: input.sourceText,
        role: input.role,
        difficulty: input.difficulty,
        count: input.items.length,
      },
    });
    await tx.questionSetItem.createMany({
      data: input.items.map((q, i) => ({
        setId: set.id,
        itemIndex: i,
        question: q.question,
        questionType: q.questionType,
      })),
    });
    return set;
  });
}

export function listQuestionSets(userId: string) {
  return prisma.questionSet.findMany({
    where: { userId, ...aliveSet },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          items: true,
          sessions: { where: { deletedAt: null } },
        },
      },
    },
  });
}

export function getQuestionSet(id: string, userId: string) {
  return prisma.questionSet.findFirst({
    where: { id, userId, ...aliveSet },
    include: {
      _count: {
        select: { sessions: { where: { deletedAt: null } } },
      },
    },
  });
}

export function getQuestionSetItems(setId: string) {
  return prisma.questionSetItem.findMany({
    where: { setId },
    orderBy: { itemIndex: "asc" },
  });
}

export async function softDeleteQuestionSet(id: string, userId: string): Promise<boolean> {
  const { count } = await prisma.questionSet.updateMany({
    where: { id, userId, ...aliveSet },
    data: { deletedAt: new Date() },
  });
  return count === 1;
}

export function listSetSessions(setId: string, userId: string) {
  return prisma.session.findMany({
    where: { questionSetId: setId, userId, ...aliveSession },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      report: { select: { overallScore: true } },
    },
  });
}

export async function copySetQuestionsInto(
  targetSessionId: string,
  setId: string,
): Promise<number> {
  const items = await getQuestionSetItems(setId);
  if (!items.length) return 0;
  const { count } = await prisma.turn.createMany({
    data: items.map((q, i) => ({
      sessionId: targetSessionId,
      turnIndex: i,
      question: q.question,
      questionType: q.questionType,
    })),
  });
  return count;
}

export function createSessionVideo(input: {
  id: string;
  sessionId: string;
  key: string;
  uploadId: string;
  expiresAt: Date;
}) {
  return prisma.sessionVideo.create({ data: input });
}

export function getSessionVideo(id: string, userId: string) {
  return prisma.sessionVideo.findFirst({
    where: { id, session: { userId, ...aliveSession } },
  });
}

export function listUnfinishedVideos(sessionId: string) {
  return prisma.sessionVideo.findMany({
    where: { sessionId, completedAt: null, uploadId: { not: null } },
  });
}

export function completeSessionVideo(id: string) {
  return prisma.sessionVideo.update({
    where: { id },
    data: { completedAt: new Date(), uploadId: null },
  });
}

export function deleteSessionVideo(id: string) {
  return prisma.sessionVideo.delete({ where: { id } });
}

export function listSessionVideos(sessionId: string) {
  return prisma.sessionVideo.findMany({
    where: { sessionId, completedAt: { not: null } },
    orderBy: { startedAt: "asc" },
  });
}

export function listExpiredVideos(take = 100) {
  return prisma.sessionVideo.findMany({
    where: { expiresAt: { lt: new Date() } },
    orderBy: { expiresAt: "asc" },
    take,
  });
}

export function listSessionsWithExpiredAudio(cutoff: Date, take = 100) {
  return prisma.session.findMany({
    where: { createdAt: { lt: cutoff }, audioPurgedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
    take,
  });
}

export function markAudioPurged(sessionId: string) {
  return prisma.$transaction([
    prisma.turn.updateMany({
      where: { sessionId, audioKey: { not: null } },
      data: { audioKey: null },
    }),
    prisma.session.update({
      where: { id: sessionId },
      data: { audioPurgedAt: new Date() },
    }),
  ]);
}

export const REPORT_LEASE_MS = 6 * 60_000;

export const MAX_REPORT_ATTEMPTS = 5;

export async function claimReportLease(sessionId: string): Promise<Session | null> {
  const now = new Date();
  const { count } = await prisma.session.updateMany({
    where: {
      id: sessionId,
      ...aliveSession,
      status: "generating_report",
      reportAttempts: { lt: MAX_REPORT_ATTEMPTS },
      OR: [{ reportLeaseUntil: null }, { reportLeaseUntil: { lt: now } }],
    },
    data: {
      reportLeaseUntil: new Date(now.getTime() + REPORT_LEASE_MS),
      reportAttempts: { increment: 1 },
    },
  });
  if (count !== 1) return null;
  return prisma.session.findUnique({ where: { id: sessionId } });
}

export function releaseReportLease(sessionId: string) {
  return prisma.session.update({
    where: { id: sessionId },
    data: { reportLeaseUntil: null },
  });
}

export function listStrandedReportSessions(take = 25) {
  const now = new Date();
  return prisma.session.findMany({
    where: {
      ...aliveSession,
      status: "generating_report",
      report: { is: null },
      reportAttempts: { gte: MAX_REPORT_ATTEMPTS },
      OR: [{ reportLeaseUntil: null }, { reportLeaseUntil: { lt: now } }],
    },
    orderBy: { updatedAt: "asc" },
    take,
    select: { id: true },
  });
}

export function listPendingReportSessions(take = 25) {
  const now = new Date();
  return prisma.session.findMany({
    where: {
      ...aliveSession,
      status: "generating_report",
      report: { is: null },
      reportAttempts: { lt: MAX_REPORT_ATTEMPTS },
      OR: [{ reportLeaseUntil: null }, { reportLeaseUntil: { lt: now } }],
    },
    orderBy: { updatedAt: "asc" },
    take,
    select: { id: true },
  });
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
    videoId?: string | null;
    videoOffsetMs?: number | null;
    cameraMetrics?: CameraTurnMetrics | null;
  },
) {
  return prisma.turn.update({
    where: { sessionId_turnIndex: { sessionId, turnIndex } },
    data: {
      audioKey: data.audioKey ?? undefined,
      videoId: data.videoId ?? undefined,
      videoOffsetMs: data.videoOffsetMs ?? undefined,
      cameraMetrics: data.cameraMetrics ? json(data.cameraMetrics) : undefined,
      transcript: data.transcript,
      transcriptWords: data.transcriptWords ? json(data.transcriptWords) : undefined,
      answerScores: json(data.answerScores),
    },
  });
}

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
  questionFeedback: unknown;
  starBreakdown: unknown;
  raw: unknown;
}

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
    questionFeedback: json(input.questionFeedback ?? []),
    starBreakdown: json(input.starBreakdown ?? []),
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

export async function getReportForUser(sessionId: string, userId: string) {
  const session = await getSession(sessionId, userId);
  if (!session) return null;
  return getReportBySession(sessionId);
}

export async function listAskedQuestions(userId: string, take = 60): Promise<string[]> {
  const turns = await prisma.turn.findMany({
    where: { session: { userId, ...aliveSession } },
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

const RUBRIC_KEYS = ["relevance", "correctness", "structure", "depth", "filler"] as const;

export function rubricMean(value: unknown): number | null {
  const s = value as AnswerScores | null;
  if (!s || RUBRIC_KEYS.some((k) => typeof s[k] !== "number")) return null;
  return (s.relevance + s.correctness + s.structure + s.depth + s.filler) / 5;
}

export async function listWeakTurns(userId: string, take = 8): Promise<WeakTurn[]> {
  const turns = await prisma.turn.findMany({
    where: { session: { userId, ...aliveSession }, transcript: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 120,
    select: { question: true, questionType: true, transcript: true, answerScores: true },
  });

  const scored = turns.flatMap((t) => {
    const mean = rubricMean(t.answerScores);
    if (mean === null) return [];
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
    where: { userId, ...aliveSession },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      name: true,
      role: true,
      status: true,
      retryOfId: true,
      report: { select: { overallScore: true } },
    },
  });
}

export function listUserReports(userId: string) {
  return prisma.report.findMany({
    where: { session: { userId, ...aliveSession } },
    orderBy: { createdAt: "asc" },
    select: { overallScore: true, createdAt: true },
  });
}

export function listUserReportsWithDelivery(userId: string) {
  return prisma.report.findMany({
    where: { session: { userId, ...aliveSession } },
    orderBy: { session: { createdAt: "asc" } },
    select: {
      overallScore: true,
      sessionId: true,
      deliveryMetrics: true,
      session: { select: { createdAt: true } },
    },
  });
}

const answeredTurn = { transcript: { not: null }, NOT: { transcript: "" } };

export function countAnsweredTurns(userId: string, sessionId: string) {
  return prisma.turn.count({
    where: {
      sessionId,
      ...answeredTurn,
      session: { userId, ...aliveSession },
    },
  });
}

export function getSessionProgress(userId: string, sessionId: string) {
  return prisma.session.findFirst({
    where: { id: sessionId, userId, ...aliveSession },
    select: {
      config: true,
      _count: { select: { turns: { where: answeredTurn } } },
      turns: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
}

export async function listRecentAnswerScores(userId: string, take = 120): Promise<AnswerScores[]> {
  const turns = await prisma.turn.findMany({
    where: { session: { userId, ...aliveSession }, transcript: { not: null } },
    orderBy: { createdAt: "desc" },
    take,
    select: { answerScores: true },
  });

  return turns.flatMap((t) => {
    const s = t.answerScores as unknown as AnswerScores | null;
    if (!s || RUBRIC_KEYS.some((k) => typeof s[k] !== "number")) return [];
    return [s];
  });
}

export const STREAK_LOOKBACK_DAYS = 400;

const STREAK_MAX_REVIEWS = 2000;

function dayKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  const parts = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, ...parts });
  } catch {
    console.warn(`[repo] unknown timezone ${JSON.stringify(timeZone)} — counting drill days in UTC`);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", ...parts });
  }
}

export function dayKeyIn(date: Date, timeZone: string): string {
  return dayKeyFormatter(timeZone).format(date);
}

export async function listReviewDays(
  userId: string,
  timeZone: string,
  since = new Date(Date.now() - STREAK_LOOKBACK_DAYS * 86_400_000),
): Promise<Set<string>> {
  const reviews = await prisma.drillReview.findMany({
    where: { userId, reviewedAt: { gte: since } },
    orderBy: { reviewedAt: "desc" },
    take: STREAK_MAX_REVIEWS,
    select: { reviewedAt: true },
  });
  const format = dayKeyFormatter(timeZone);
  return new Set(reviews.map((r) => format.format(r.reviewedAt)));
}

export function countDrillReviewsSince(userId: string, since: Date): Promise<number> {
  return prisma.drillReview.count({ where: { userId, reviewedAt: { gte: since } } });
}

const dueCard = (now: Date) => ({ suspendedAt: null, dueAt: { lte: now } });

export interface UpsertDrillCardInput {
  userId: string;
  question: string;
  questionType: QuestionType;
  sourceTurnId?: string | null;
  bestTranscript?: string | null;
  bestMean?: number | null;
}

export async function upsertDrillCard(
  input: UpsertDrillCardInput,
): Promise<{ id: string; created: boolean }> {
  const hash = questionHash(input.question);
  const key = { userId_questionHash: { userId: input.userId, questionHash: hash } };

  const existing = await prisma.drillCard.findUnique({
    where: key,
    select: { id: true, bestMean: true },
  });

  const beatsBest =
    input.bestTranscript != null &&
    typeof input.bestMean === "number" &&
    (existing === null || existing.bestMean === null || input.bestMean > existing.bestMean);
  const best = beatsBest
    ? { bestTranscript: input.bestTranscript, bestMean: input.bestMean }
    : {};

  const card = await prisma.drillCard.upsert({
    where: key,
    create: {
      userId: input.userId,
      question: input.question,
      questionType: input.questionType,
      questionHash: hash,
      sourceTurnId: input.sourceTurnId ?? null,
      ...best,
    },
    update: best,
    select: { id: true },
  });
  return { id: card.id, created: existing === null };
}

export interface AddDrillCardInput {
  userId: string;
  question: string;
  questionType: QuestionType;
  sourceTurnId?: string | null;
}

export function addDrillCard(input: AddDrillCardInput): Promise<{ id: string }> {
  const hash = questionHash(input.question);
  return prisma.drillCard.upsert({
    where: { userId_questionHash: { userId: input.userId, questionHash: hash } },
    create: {
      userId: input.userId,
      question: input.question,
      questionType: input.questionType,
      questionHash: hash,
      sourceTurnId: input.sourceTurnId ?? null,
    },
    update: { dueAt: new Date(), suspendedAt: null },
    select: { id: true },
  });
}

export function listDueDrillCards(userId: string, take: number, now = new Date()) {
  return prisma.drillCard.findMany({
    where: { userId, ...dueCard(now) },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take,
  });
}

export function listAheadDrillCards(
  userId: string,
  take: number,
  exclude: string[] = [],
  now = new Date(),
) {
  return prisma.drillCard.findMany({
    where: {
      userId,
      suspendedAt: null,
      dueAt: { gt: now },
      ...(exclude.length ? { id: { notIn: exclude } } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take,
  });
}

export function countDueDrillCards(userId: string, now = new Date()): Promise<number> {
  return prisma.drillCard.count({ where: { userId, ...dueCard(now) } });
}

export function getDrillCard(cardId: string, userId: string) {
  return prisma.drillCard.findFirst({ where: { id: cardId, userId } });
}

export interface RecordDrillReviewInput {
  cardId: string;
  userId: string;
  grade: number;
  transcript?: string | null;
  answerScores?: AnswerScores | null;
  schedule: { ease: number; intervalDays: number; repetitions: number; dueAt: Date };
  attempt?: { transcript: string; mean: number } | null;
}

export async function recordDrillReview(input: RecordDrillReviewInput): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const card = await tx.drillCard.findFirst({
      where: { id: input.cardId, userId: input.userId },
      select: { id: true, bestMean: true },
    });
    if (!card) return false;

    const attempt = input.attempt;
    const beatsBest = attempt != null && (card.bestMean === null || attempt.mean > card.bestMean);

    await tx.drillCard.update({
      where: { id: card.id },
      data: {
        ease: input.schedule.ease,
        intervalDays: input.schedule.intervalDays,
        repetitions: input.schedule.repetitions,
        dueAt: input.schedule.dueAt,
        lastGrade: input.grade,
        ...(beatsBest && attempt
          ? { bestTranscript: attempt.transcript, bestMean: attempt.mean }
          : {}),
      },
    });

    await tx.drillReview.create({
      data: {
        cardId: card.id,
        userId: input.userId,
        grade: input.grade,
        transcript: input.transcript ?? null,
        answerScores: input.answerScores ? json(input.answerScores) : Prisma.JsonNull,
      },
    });
    return true;
  });
}

export async function suspendDrillCard(cardId: string, userId: string): Promise<boolean> {
  const { count } = await prisma.drillCard.updateMany({
    where: { id: cardId, userId, suspendedAt: null },
    data: { suspendedAt: new Date() },
  });
  return count === 1;
}

export interface DigestCandidate {
  id: string;
  email: string;
  name: string | null;
  timezone: string | null;
  dueCount: number;
  firstDueQuestion: string | null;
}

export function listDigestCandidates(
  cutoff: Date,
  take = 50,
  now = new Date(),
): Promise<DigestCandidate[]> {
  const due = dueCard(now);
  return prisma.user
    .findMany({
      where: {
        emailDigest: true,
        OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: cutoff } }],
        drillCards: { some: due },
      },
      orderBy: { lastDigestAt: { sort: "asc", nulls: "first" } },
      take,
      select: {
        id: true,
        email: true,
        name: true,
        timezone: true,
        drillCards: {
          where: due,
          orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
          take: 1,
          select: { question: true },
        },
        _count: { select: { drillCards: { where: due } } },
      },
    })
    .then((rows) =>
      rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        timezone: u.timezone,
        dueCount: u._count.drillCards,
        firstDueQuestion: u.drillCards[0]?.question ?? null,
      })),
    );
}

export async function claimDrillDigest(userId: string, cutoff: Date): Promise<boolean> {
  const { count } = await prisma.user.updateMany({
    where: {
      id: userId,
      emailDigest: true,
      OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: cutoff } }],
    },
    data: { lastDigestAt: new Date() },
  });
  return count === 1;
}

export function createPasswordResetToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<{ id: string }> {
  return prisma.passwordResetToken.create({
    data: input,
    select: { id: true },
  });
}

export function findPasswordResetToken(
  tokenHash: string,
): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null> {
  return prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
}

export async function consumePasswordResetToken(id: string): Promise<boolean> {
  const { count } = await prisma.passwordResetToken.updateMany({
    where: { id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

export async function invalidateUserResetTokens(userId: string): Promise<void> {
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
}

export function upsertReportShare(sessionId: string, tokenHash: string): Promise<{ id: string }> {
  return prisma.reportShare.upsert({
    where: { sessionId },
    create: { sessionId, tokenHash },
    update: { tokenHash, revokedAt: null, createdAt: new Date() },
    select: { id: true },
  });
}

export async function hasLiveReportShare(sessionId: string, userId: string): Promise<boolean> {
  const share = await prisma.reportShare.findFirst({
    where: { sessionId, revokedAt: null, session: { userId, ...aliveSession } },
    select: { id: true },
  });
  return share !== null;
}

export async function revokeReportShare(sessionId: string, userId: string): Promise<boolean> {
  const { count } = await prisma.reportShare.updateMany({
    where: { sessionId, revokedAt: null, session: { userId, ...aliveSession } },
    data: { revokedAt: new Date() },
  });
  return count === 1;
}

export interface SharedReport {
  sessionId: string;
  name: string | null;
  role: string | null;
  createdAt: Date;
  questionCount: number;
  overallScore: number;
  verdict: string;
  categoryScores: unknown;
  deliveryMetrics: unknown;
  strengths: unknown;
  weaknesses: unknown;
  starBreakdown: unknown;
}

function starBarsWithoutWords(column: unknown): unknown {
  if (!Array.isArray(column)) return [];
  return column.map((bar) => {
    if (typeof bar !== "object" || bar === null) return bar;
    const segments = (bar as { segments?: unknown }).segments;
    if (!Array.isArray(segments)) return bar;
    return {
      ...bar,
      segments: segments.map((seg) =>
        typeof seg === "object" && seg !== null ? { ...seg, text: "" } : seg,
      ),
    };
  });
}

export async function getSharedReport(tokenHash: string): Promise<SharedReport | null> {
  const share = await prisma.reportShare.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      session: { status: "completed", ...aliveSession },
    },
    select: {
      session: {
        select: {
          id: true,
          name: true,
          role: true,
          createdAt: true,
          _count: { select: { turns: true } },
          report: {
            select: {
              overallScore: true,
              verdict: true,
              categoryScores: true,
              deliveryMetrics: true,
              strengths: true,
              weaknesses: true,
              starBreakdown: true,
            },
          },
        },
      },
    },
  });
  const session = share?.session;
  if (!session?.report) return null;

  return {
    sessionId: session.id,
    name: session.name,
    role: session.role,
    createdAt: session.createdAt,
    questionCount: session._count.turns,
    overallScore: session.report.overallScore,
    verdict: session.report.verdict,
    categoryScores: session.report.categoryScores,
    deliveryMetrics: session.report.deliveryMetrics,
    strengths: session.report.strengths,
    weaknesses: session.report.weaknesses,
    starBreakdown: starBarsWithoutWords(session.report.starBreakdown),
  };
}

export function getCompanyBrief(companyKey: string, roleKey: string) {
  return prisma.companyBrief.findUnique({
    where: { companyKey_roleKey: { companyKey, roleKey } },
  });
}

export interface UpsertCompanyBriefInput {
  companyKey: string;
  roleKey: string;
  company: string;
  role: string | null;
  brief: unknown;
  grounded: boolean;
  sources: unknown;
  raw: unknown;
}

export function upsertCompanyBrief(input: UpsertCompanyBriefInput) {
  const fields = {
    company: input.company,
    role: input.role,
    brief: json(input.brief),
    grounded: input.grounded,
    sources: json(input.sources ?? []),
    raw: json(input.raw),
    createdAt: new Date(),
  };
  return prisma.companyBrief.upsert({
    where: { companyKey_roleKey: { companyKey: input.companyKey, roleKey: input.roleKey } },
    create: { companyKey: input.companyKey, roleKey: input.roleKey, ...fields },
    update: fields,
  });
}
