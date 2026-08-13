import "server-only";
/**
 * Data access. Thin wrappers over the shared Prisma client (@repo/db).
 * HARD RULE #11: every session/report query filters on the authenticated
 * user_id — a user can only ever touch their own data.
 *
 * Soft-delete: a session with `deletedAt` set must be treated as if it never
 * existed for the user — dashboard, reports, media, starring links, and especially
 * the do-not-reuse / weak_spots question lists. Retention sweeps may still see
 * deleted rows; every user-facing read uses `aliveSession` below.
 */
import { createHash } from "node:crypto";
import { prisma, Prisma } from "@repo/db";
import type { Session } from "@repo/db";
import type {
  AnswerScores,
  InterviewConfig,
  QuestionSetSource,
  QuestionType,
  SessionStatus,
  SourceType,
  TranscriptWord,
} from "@repo/types";

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Nested under `session: { … }` or as a session `where` — not soft-deleted. */
const aliveSession = { deletedAt: null } as const;

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

export function updateUserProfile(
  id: string,
  patch: { name?: string | null; emailOnReport?: boolean },
) {
  return prisma.user.update({
    where: { id },
    data: { name: patch.name, emailOnReport: patch.emailOnReport },
  });
}

export function updateUserPassword(id: string, passwordHash: string) {
  return prisma.user.update({ where: { id }, data: { passwordHash } });
}

// ── Sessions (always user-scoped) ─────────────────────────────────
export interface CreateSessionInput {
  userId: string;
  sourceType: SourceType;
  sourceText: string;
  /** The user's own name for this interview. */
  name: string;
  role: string | null;
  config: InterviewConfig;
  /** Set to re-run an earlier session on identical questions. */
  retryOfId?: string | null;
  /** Set when this interview runs a question-bank set's questions verbatim. */
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

/** Fetch a session that belongs to this user (null otherwise). Soft-deleted rows are invisible. */
export function getSession(id: string, userId: string) {
  return prisma.session.findFirst({ where: { id, userId, ...aliveSession } });
}

/**
 * Soft-delete an interview. Rows stay (turns, report, media keys) so retention
 * sweeps can still run; every user-facing read filters `deletedAt: null`.
 *
 * Stars keep the question text but lose the link back — same as a hard delete's
 * SetNull on `turnId` — so the collection doesn't point at a ghost report.
 */
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

// ── Starred questions ─────────────────────────────────────────────

/**
 * The dedupe key for a question.
 *
 * Normalised before hashing so trivial differences don't split one question into
 * two stars: case, surrounding space, and runs of whitespace (a question that
 * came back through a retry can differ by a line break alone).
 */
export function questionHash(question: string): string {
  const normalized = question.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Star a question, by turn.
 *
 * The text is copied onto the star rather than referenced: Turn cascades away
 * with its Session, and a star that vanished when you deleted the interview it
 * came from would defeat the point of a collection.
 *
 * Upsert, not create: the unique index on (userId, questionHash) does the
 * deduping, so starring the same question again — from a retry, or a double
 * click — is idempotent instead of a 500.
 */
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
    // Already starred: leave the original alone, including which turn it came
    // from. The first time they liked it is the truthful answer.
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
      // Soft-deleted sessions still have Turn rows; hide the link so the star
      // behaves as if that interview never existed.
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

/** Which of these questions are already starred, as a set of hashes. */
export async function starredHashesFor(userId: string, questions: string[]): Promise<Set<string>> {
  const hashes = questions.map(questionHash);
  const rows = await prisma.starredQuestion.findMany({
    where: { userId, questionHash: { in: hashes } },
    select: { questionHash: true },
  });
  return new Set(rows.map((r) => r.questionHash));
}

/** A turn, scoped to its owner (HARD RULE #11) — starring needs both. */
export function getTurnForUser(turnId: string, userId: string) {
  return prisma.turn.findFirst({
    where: { id: turnId, session: { userId, ...aliveSession } },
    select: { id: true, question: true, questionType: true },
  });
}

// ── Question bank (always user-scoped) ────────────────────────────

/** Same contract as `aliveSession`, for sets. */
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

/**
 * Persist a fully generated set — the set row and every item, atomically.
 * One transaction because a set with half its questions is not a smaller set,
 * it's a broken one: `count` would disagree with the items, and the "run an
 * interview" path copies items by index and trusts them to be 0..n-1.
 */
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

/**
 * The user's sets, newest first, each carrying its live item count and how
 * many interviews have been run on it (soft-deleted interviews excluded — a
 * deleted run should stop counting as practice, same as everywhere else).
 */
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

/** A set's questions, in reading order. */
export function getQuestionSetItems(setId: string) {
  return prisma.questionSetItem.findMany({
    where: { setId },
    orderBy: { itemIndex: "asc" },
  });
}

/**
 * Soft-delete a set. Interviews already run from it are untouched — they hold
 * their own copies of the questions (see copySetQuestionsInto), so nothing
 * they replay or report on lives in these rows.
 */
export async function softDeleteQuestionSet(id: string, userId: string): Promise<boolean> {
  const { count } = await prisma.questionSet.updateMany({
    where: { id, userId, ...aliveSet },
    data: { deletedAt: new Date() },
  });
  return count === 1;
}

/**
 * Interviews run on this set, newest first — the set page's "your runs" list.
 * Report presence rides along so a completed run can link straight to it.
 */
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

/**
 * Copy a set's questions into a session's turns, verbatim and in order — the
 * exact mechanism a retry uses (`copyQuestionsInto`), pointed at the bank.
 * New Turn rows with new ids: the interview owns its copies, so the set can be
 * deleted, re-read or re-run without either side noticing the other.
 */
export async function copySetQuestionsInto(
  targetSessionId: string,
  setId: string,
): Promise<number> {
  const items = await getQuestionSetItems(setId);
  if (!items.length) return 0;
  const { count } = await prisma.turn.createMany({
    data: items.map((q, i) => ({
      sessionId: targetSessionId,
      // Re-numbered from 0 rather than trusting itemIndex: the room's
      // "answered everything" check assumes 0-based contiguous turns, and this
      // is the one place that invariant is cheap to guarantee.
      turnIndex: i,
      question: q.question,
      questionType: q.questionType,
    })),
  });
  return count;
}

// ── Session video ─────────────────────────────────────────────────

export function createSessionVideo(input: {
  /** Minted by the caller: the R2 object key embeds it, so it can't be defaulted. */
  id: string;
  sessionId: string;
  key: string;
  uploadId: string;
  expiresAt: Date;
}) {
  return prisma.sessionVideo.create({ data: input });
}

/** User-scoped (HARD RULE #11): another user's video id is simply not found. */
export function getSessionVideo(id: string, userId: string) {
  return prisma.sessionVideo.findFirst({
    where: { id, session: { userId, ...aliveSession } },
  });
}

/** Recordings for a session that never got completed — an upload that died. */
export function listUnfinishedVideos(sessionId: string) {
  return prisma.sessionVideo.findMany({
    where: { sessionId, completedAt: null, uploadId: { not: null } },
  });
}

export function completeSessionVideo(id: string) {
  return prisma.sessionVideo.update({
    where: { id },
    // uploadId cleared: it's spent, and a null is what marks this row settled.
    data: { completedAt: new Date(), uploadId: null },
  });
}

export function deleteSessionVideo(id: string) {
  return prisma.sessionVideo.delete({ where: { id } });
}

/** Playable recordings for a session, oldest first — the replay's timeline. */
export function listSessionVideos(sessionId: string) {
  return prisma.sessionVideo.findMany({
    where: { sessionId, completedAt: { not: null } },
    orderBy: { startedAt: "asc" },
  });
}

/** The retention sweep's queue: past expiry, object still in R2. */
export function listExpiredVideos(take = 100) {
  return prisma.sessionVideo.findMany({
    where: { expiresAt: { lt: new Date() } },
    orderBy: { expiresAt: "asc" },
    take,
  });
}

// ── Audio retention ───────────────────────────────────────────────

/**
 * The audio sweep's queue: created before `cutoff` and not yet purged.
 *
 * Oldest first, so a backlog too big for one run drains in age order rather
 * than starving the oldest clips — the ones we most owe a deletion.
 */
export function listSessionsWithExpiredAudio(cutoff: Date, take = 100) {
  return prisma.session.findMany({
    where: { createdAt: { lt: cutoff }, audioPurgedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
    take,
  });
}

/**
 * Record that a session's clips are gone, and drop the keys that named them.
 *
 * One transaction: a purge marked but keys left behind would leave the report
 * and replay pointing at objects that 404, and keys cleared without the marker
 * would re-list the session every night forever. Neither half stands alone.
 */
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

// ── Report queue ──────────────────────────────────────────────────

/**
 * How long a claim holds. Must comfortably exceed the worst-case build (two LLM
 * passes, each up to 7 key-rotation attempts, plus a cold Render acoustics
 * service) — a lease that expires mid-build invites a second worker in.
 */
export const REPORT_LEASE_MS = 6 * 60_000;

/** Past this many claims a session is failed out rather than retried forever. */
export const MAX_REPORT_ATTEMPTS = 5;

/**
 * Try to take the build lease on one session. Returns the session on success,
 * null if someone else holds it, it's already built, or it's out of attempts.
 *
 * The whole no-double-processing guarantee lives in this one statement.
 * `updateMany` compiles to a single `UPDATE ... WHERE`, which Postgres executes
 * atomically: concurrent callers serialise on the row, and only the one whose
 * WHERE still matches gets count === 1. The loser sees 0 and walks away.
 *
 * Deliberately NOT raw SQL. Tables live in the `ai_interview` schema (packages/db
 * derives it from the URL) and @prisma/adapter-pg never sets search_path, so a
 * hand-written `UPDATE sessions` would fail with "relation does not exist" —
 * and there is no other raw SQL here to have taught us that. Going through the
 * query engine gets the schema qualification for free.
 *
 * Not user-scoped, and it's the one exception to HARD RULE #11 in this file:
 * the worker acts for the system, not a user, and the session id comes from the
 * queue rather than a request. Every caller that IS user-facing must have
 * checked ownership before getting here.
 */
export async function claimReportLease(sessionId: string): Promise<Session | null> {
  const now = new Date();
  const { count } = await prisma.session.updateMany({
    where: {
      id: sessionId,
      ...aliveSession,
      status: "generating_report",
      reportAttempts: { lt: MAX_REPORT_ATTEMPTS },
      // Free, or the previous holder's lease has run out (it died).
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

/** Hand the lease back without finishing — the next pass may pick it straight up. */
export function releaseReportLease(sessionId: string) {
  return prisma.session.update({
    where: { id: sessionId },
    data: { reportLeaseUntil: null },
  });
}

/**
 * Sessions the queue has quietly given up on.
 *
 * `generating_report` with the attempts spent is a state nothing can leave on
 * its own: `claimReportLease` and `listPendingReportSessions` both require
 * `attempts < MAX`, so the row is invisible to every worker while its status
 * still promises a report is coming. The build's own catch normally fails such a
 * session out, but it only runs if the build *threw* — one killed mid-flight
 * (the function timing out is the common way) never reaches it, and a re-queue
 * of an already-failed session walks straight back in.
 *
 * These are those rows, and the sweep exists to give them the ending the build
 * never got to write.
 */
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

/**
 * Sessions waiting on a report, oldest first.
 *
 * Leased rows are excluded rather than skipped later: this is what stops a
 * sweep from handing out work another run is still holding.
 */
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
    /** Where this answer sits in the session recording, if there was one. */
    videoId?: string | null;
    videoOffsetMs?: number | null;
  },
) {
  return prisma.turn.update({
    where: { sessionId_turnIndex: { sessionId, turnIndex } },
    data: {
      audioKey: data.audioKey ?? undefined,
      // `?? undefined` throughout: an absent value must leave the column alone,
      // never null it out. A retry of a failed submit can arrive without the
      // video fields, and it must not erase the offsets the first one wrote.
      videoId: data.videoId ?? undefined,
      videoOffsetMs: data.videoOffsetMs ?? undefined,
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
  questionFeedback: unknown;
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
    questionFeedback: json(input.questionFeedback ?? []),
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
 * Soft-deleted interviews are omitted entirely — deleting an interview means
 * those questions may be asked again (as if that session never happened).
 *
 * Capped: someone practising weekly racks up hundreds of questions, and the
 * whole list would be pasted into every prompt — that's real tokens on every
 * turn, for questions they last saw months ago. The recent ones are the ones
 * they'd actually notice repeating.
 */
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

/**
 * Answered turns this user scored worst on — the raw material for `weak_spots`.
 * Soft-deleted interviews are ignored (same as listAskedQuestions).
 * Only turns with both a transcript and scores can be judged, and scoring is
 * done here rather than in SQL because answer_scores is a JSON blob.
 */
export async function listWeakTurns(userId: string, take = 8): Promise<WeakTurn[]> {
  const turns = await prisma.turn.findMany({
    where: { session: { userId, ...aliveSession }, transcript: { not: null } },
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

/** Scores and dates, oldest first — what a page needs to say "how you're doing". */
export function listUserReports(userId: string) {
  return prisma.report.findMany({
    where: { session: { userId, ...aliveSession } },
    orderBy: { createdAt: "asc" },
    select: { overallScore: true, createdAt: true },
  });
}

/**
 * The same list plus what the dashboard's per-answer filler figure reads.
 *
 * Its own function rather than a wider `listUserReports`: delivery_metrics is a
 * whole JSON blob per report, and /profile reads nothing but the score — it
 * would be paying to transfer every session's metrics to render an average.
 *
 * Ordered by SESSION date, not report date. Report building is an async queue
 * with leases and retries, so a session sat on Monday whose first build failed
 * and was swept up on Wednesday gets a report row created after Tuesday's
 * session. Everything the dashboard says directionally reads this order —
 * "climbed from X to Y", "since your first session", the sparkline, and the
 * last-7-days count — so ordering by build time would tell a user they improved
 * backwards. `Session.createdAt` is also the only date the UI ever shows against
 * a session, so this keeps the prose and the list agreeing.
 */
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

// An empty transcript is not an answer. deliveryService counts fillers
// only for turns with text, so counting the empty ones here would inflate
// the denominator alone and report fewer fillers per answer than there were.
const answeredTurn = { transcript: { not: null }, NOT: { transcript: "" } };

/**
 * How many turns in this session were actually answered — the denominator for
 * anything the report states as a session total.
 *
 * Filtered through the session rather than by `sessionId` alone so a stray id
 * can never count someone else's interview, or a soft-deleted one.
 */
export function countAnsweredTurns(userId: string, sessionId: string) {
  return prisma.turn.count({
    where: {
      sessionId,
      ...answeredTurn,
      session: { userId, ...aliveSession },
    },
  });
}

/** Where an unfinished interview was left: its config, its answered turns, and
 *  the newest turn's timestamp. */
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

/** The five rubric keys, so a half-written score can be rejected as a whole. */
const RUBRIC_KEYS = ["relevance", "correctness", "structure", "depth", "filler"] as const;

/**
 * The rubric off this user's recent answered turns and nothing else.
 *
 * Same read as `listWeakTurns` without the transcript or the question: the
 * dashboard only averages the five numbers, and the dashboard is force-dynamic,
 * so it re-runs this on every view.
 */
export async function listRecentAnswerScores(userId: string, take = 120): Promise<AnswerScores[]> {
  const turns = await prisma.turn.findMany({
    where: { session: { userId, ...aliveSession }, transcript: { not: null } },
    orderBy: { createdAt: "desc" },
    take,
    select: { answerScores: true },
  });

  // answer_scores is an opaque JSON column, so nothing about its shape is
  // guaranteed at this boundary — an unscored or half-written turn drops out
  // rather than poisoning the average with NaN. Every key is checked, not just
  // the first: the caller averages all five independently.
  return turns.flatMap((t) => {
    const s = t.answerScores as unknown as AnswerScores | null;
    if (!s || RUBRIC_KEYS.some((k) => typeof s[k] !== "number")) return [];
    return [s];
  });
}

// ── Password reset tokens ─────────────────────────────────────────
/**
 * The one group of queries in this file that is NOT user-scoped, and it is not a
 * mistake: a reset happens before there is any session, so the token IS the
 * credential being presented. Filtering by userId would mean already knowing who
 * the caller is, which is precisely what the token is there to establish.
 *
 * What replaces HARD RULE #11 here: only the sha256 of the raw token is ever
 * stored or looked up, tokens expire, and they are single-use.
 */

/** Stores the digest only — the caller keeps the raw token for the email. */
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

/**
 * Look up a reset token by its digest.
 *
 * Never by the raw token: nothing raw is in the table, so there is nothing to
 * match against — and that is the property a database leak relies on.
 *
 * Expiry and used-ness are returned rather than filtered so the caller decides;
 * every rejection reason ends in the same generic error either way.
 */
export function findPasswordResetToken(
  tokenHash: string,
): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null> {
  return prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
}

/**
 * Atomically marks the token used. Returns false if another caller already did.
 *
 * `updateMany` compiles to a single `UPDATE ... WHERE id = ? AND used_at IS NULL`,
 * which Postgres executes atomically: concurrent callers serialise on the row and
 * only one gets count === 1. A read-then-write is the bug this function exists to
 * prevent — two submissions of the same link (a double click, or an email
 * scanner following it first) would both see `usedAt: null`, both pass, and the
 * "single use" guarantee would be decoration.
 */
export async function consumePasswordResetToken(id: string): Promise<boolean> {
  const { count } = await prisma.passwordResetToken.updateMany({
    where: { id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

/**
 * Belt-and-braces after a successful reset: kills every other outstanding token.
 *
 * Someone who asked for three links and used the newest must not be left with two
 * that still work — most reset abuse starts with an old link found in a mailbox.
 */
export async function invalidateUserResetTokens(userId: string): Promise<void> {
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
}

// ── Report shares ─────────────────────────────────────────────────

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
  };
}
