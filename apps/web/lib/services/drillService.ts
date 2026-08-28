import "server-only";
import type {
  AnswerScores,
  DrillAnswerResponse,
  DrillCardDTO,
  DrillQueueResponse,
  DrillReviewResponse,
  QuestionType,
} from "@repo/types";
import type { DrillCard, Turn } from "@repo/db";
import { notFound } from "@/lib/errors";
import { drillFeedbackSchema } from "@/lib/schemas";
import { config } from "@/lib/env";
import * as repo from "@/lib/db/repo";
import { generateJson } from "@/lib/clients/llmJson";
import { DRILL_FEEDBACK_SYSTEM, drillFeedbackPrompt } from "@/lib/prompts/drillFeedback";
import { scoreAnswer } from "@/lib/services/evaluationService";
import { gradeFromScores, schedule, startOfDayIn, streakDays } from "@/lib/drill/sm2";
import { mailConfigured, sendMail } from "@/lib/mail/mailer";
import { renderDrillDigestEmail } from "@/lib/mail/templates/drillDigest";

const SEED_MEAN_MAX = 6;

const SEED_NEW_CARDS_MAX = 5;

const AHEAD_CARDS = 2;

const DIGEST_BATCH = 50;

const DAY_MS = 86_400_000;

const FALLBACK_ZONE = "UTC";

export async function seedDrillCards(userId: string, turns: Turn[]): Promise<number> {
  const weak = turns
    .flatMap((t) => {
      if (!t.transcript) return [];
      const mean = repo.rubricMean(t.answerScores);
      if (mean === null || mean >= SEED_MEAN_MAX) return [];
      return [{ turn: t, mean }];
    })
    .sort((a, b) => a.mean - b.mean)
    .slice(0, SEED_NEW_CARDS_MAX);

  let created = 0;
  for (const { turn, mean } of weak) {
    const card = await repo.upsertDrillCard({
      userId,
      question: turn.question,
      questionType: turn.questionType,
      sourceTurnId: turn.id,
      bestTranscript: turn.transcript,
      bestMean: mean,
    });
    if (card.created) created += 1;
  }
  return created;
}

export function addDrillCard(
  userId: string,
  turn: { id: string; question: string; questionType: QuestionType },
): Promise<{ id: string }> {
  return repo.addDrillCard({
    userId,
    question: turn.question,
    questionType: turn.questionType,
    sourceTurnId: turn.id,
  });
}

export async function addDrillCardByTurnId(
  userId: string,
  turnId: string,
): Promise<{ id: string }> {
  const turn = await repo.getTurnForUser(turnId, userId);
  if (!turn) throw notFound("Question not found.", "unknown_turn");
  return addDrillCard(userId, turn);
}

export function suspendDrillCard(userId: string, cardId: string): Promise<boolean> {
  return repo.suspendDrillCard(cardId, userId);
}

function toCardDTO(card: DrillCard, ahead: boolean): DrillCardDTO {
  return {
    id: card.id,
    question: card.question,
    question_type: card.questionType,
    due_at: card.dueAt.toISOString(),
    interval_days: card.intervalDays,
    repetitions: card.repetitions,
    last_grade: card.lastGrade,
    best_transcript: card.bestTranscript,
    best_mean: card.bestMean,
    ahead,
  };
}

export async function getDrillQueue(
  userId: string,
  opts: { limit?: number; exclude?: string[]; now?: Date } = {},
): Promise<DrillQueueResponse> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? config.drill.dailyCards;
  const exclude = opts.exclude ?? [];

  const user = await repo.getUserById(userId);
  const zone = user?.timezone ?? FALLBACK_ZONE;

  const [due, dueTotal, reviewDays, reviewedToday] = await Promise.all([
    repo.listDueDrillCards(userId, limit, now),
    repo.countDueDrillCards(userId, now),
    repo.listReviewDays(userId, zone),
    repo.countDrillReviewsSince(userId, startOfDayIn(now, zone)),
  ]);

  const fresh = due.filter((c) => !exclude.includes(c.id));
  const cards = fresh.map((c) => toCardDTO(c, false));
  if (cards.length === 0) {
    const ahead = await repo.listAheadDrillCards(userId, AHEAD_CARDS, exclude, now);
    cards.push(...ahead.map((c) => toCardDTO(c, true)));
  }

  return {
    cards,
    due_total: dueTotal,
    streak_days: streakDays(reviewDays, repo.dayKeyIn(now, zone)),
    reviewed_today: reviewedToday,
  };
}

export async function drillStats(
  userId: string,
  timeZone: string | null,
  now = new Date(),
): Promise<{ streak_days: number; cards_due: number }> {
  const zone = timeZone ?? FALLBACK_ZONE;
  const [days, due] = await Promise.all([
    repo.listReviewDays(userId, zone),
    repo.countDueDrillCards(userId, now),
  ]);
  return { streak_days: streakDays(days, repo.dayKeyIn(now, zone)), cards_due: due };
}

export interface DrillAnswerInput {
  userId: string;
  cardId: string;
  transcript: string;
}

export async function answerDrillCard(input: DrillAnswerInput): Promise<DrillAnswerResponse> {
  const card = await repo.getDrillCard(input.cardId, input.userId);
  if (!card) throw notFound("Drill card not found.", "unknown_card");

  const answerScores = await scoreAnswer(card.question, card.questionType, input.transcript);
  const mean = repo.rubricMean(answerScores) ?? 0;
  const coaching = await coach(card.question, input.transcript, card.bestTranscript);

  return {
    card_id: card.id,
    transcript: input.transcript,
    answer_scores: answerScores,
    suggested_grade: gradeFromScores(mean),
    improvements: coaching?.improvements ?? [],
    better_line: coaching?.better_line ?? null,
    previous_best: card.bestTranscript,
  };
}

async function coach(
  question: string,
  transcript: string,
  previousBest: string | null,
): Promise<{ improvements: string[]; better_line: string } | null> {
  try {
    const { value } = await generateJson(drillFeedbackSchema, {
      system: DRILL_FEEDBACK_SYSTEM,
      prompt: drillFeedbackPrompt(question, transcript, previousBest),
      temperature: 0.4,
    });
    return value;
  } catch (err) {
    console.warn("[drill] coaching skipped:", err);
    return null;
  }
}

export interface DrillReviewInput {
  userId: string;
  cardId: string;
  grade: number;
  transcript?: string | null;
  answerScores?: AnswerScores | null;
  now?: Date;
}

export async function reviewDrillCard(input: DrillReviewInput): Promise<DrillReviewResponse> {
  const now = input.now ?? new Date();

  const [card, user] = await Promise.all([
    repo.getDrillCard(input.cardId, input.userId),
    repo.getUserById(input.userId),
  ]);
  if (!card) throw notFound("Drill card not found.", "unknown_card");

  const next = schedule(
    { ease: card.ease, intervalDays: card.intervalDays, repetitions: card.repetitions },
    input.grade,
    now,
  );

  const mean = input.answerScores ? repo.rubricMean(input.answerScores) : null;
  const transcript = input.transcript?.trim() || null;
  const attempt = transcript !== null && mean !== null ? { transcript, mean } : null;

  const moved = await repo.recordDrillReview({
    cardId: card.id,
    userId: input.userId,
    grade: input.grade,
    transcript,
    answerScores: input.answerScores ?? null,
    schedule: next,
    attempt,
  });
  if (!moved) throw notFound("Drill card not found.", "unknown_card");

  const zone = user?.timezone ?? FALLBACK_ZONE;
  const days = await repo.listReviewDays(input.userId, zone);

  return {
    due_at: next.dueAt.toISOString(),
    interval_days: next.intervalDays,
    streak_days: streakDays(days, repo.dayKeyIn(now, zone)),
  };
}

export async function sendDrillDigests(now = new Date()): Promise<number> {
  if (!mailConfigured()) return 0;

  const cutoff = new Date(now.getTime() - config.drill.digestDays * DAY_MS);
  const candidates = await repo.listDigestCandidates(cutoff, DIGEST_BATCH, now);

  let sent = 0;
  for (const candidate of candidates) {
    try {
      if (!(await repo.claimDrillDigest(candidate.id, cutoff))) continue;

      const zone = candidate.timezone ?? FALLBACK_ZONE;
      const days = await repo.listReviewDays(candidate.id, zone);

      await sendMail({
        to: candidate.email,
        ...renderDrillDigestEmail({
          name: candidate.name,
          dueCount: candidate.dueCount,
          streakDays: streakDays(days, repo.dayKeyIn(now, zone)),
          firstQuestion: candidate.firstDueQuestion,
          drillUrl: `${config.site.url}/drill`,
          profileUrl: `${config.site.url}/profile`,
        }),
      });
      sent += 1;
    } catch (err) {
      console.error(`[drill] digest for ${candidate.id} failed:`, err);
    }
  }
  return sent;
}
