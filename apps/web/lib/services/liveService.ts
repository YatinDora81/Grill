import "server-only";
import type { Session } from "@repo/db";
import type { AnswerScores, LiveTurnInput, QuestionType } from "@repo/types";
import { config } from "@/lib/env";
import { conflict, serviceUnavailable } from "@/lib/errors";
import { getRedis } from "@/lib/redis";
import * as repo from "@/lib/db/repo";
import { scoreAnswer } from "./evaluationService";

const SLOT_PREFIX = "grill:live:slot:";

const SCORE_CONCURRENCY = 3;

const LIVE_BUSY =
  "Every live seat is taken right now — try again in a few minutes, or run the standard interview.";

export async function acquireLiveSlot(sessionId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const key = `${SLOT_PREFIX}${sessionId}`;
  const ttl = (config.live.maxMinutes + 2) * 60;
  await redis.set(key, "1", { nx: true, ex: ttl });
  const active = (await redis.keys(`${SLOT_PREFIX}*`)).length;
  if (active > config.live.maxConcurrent) {
    await redis.del(key);
    throw serviceUnavailable(LIVE_BUSY, "live_busy");
  }
}

export async function releaseLiveSlot(sessionId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(`${SLOT_PREFIX}${sessionId}`);
  } catch (err) {
    console.warn(`[live] could not release the seat for ${sessionId}:`, err);
  }
}

function trimTrailingSilence(turns: LiveTurnInput[]): LiveTurnInput[] {
  const pairs = [...turns];
  while (pairs.length > 0 && !pairs[pairs.length - 1]!.answer.trim()) pairs.pop();
  return pairs;
}

export async function persistLiveTurns(
  session: Session,
  turns: LiveTurnInput[],
): Promise<number> {
  const opener = await repo.getTurn(session.id, 0);
  if (!opener) throw conflict("The interview has no opening question.", "unknown_turn");

  const pairs = trimTrailingSilence(turns);
  if (pairs.length === 0) return 0;

  const typeFor = (index: number): QuestionType =>
    index === 0 ? opener.questionType : "followup";

  const scores: (AnswerScores | null)[] = new Array(pairs.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < pairs.length) {
      const i = next++;
      const pair = pairs[i]!;
      const question = i === 0 ? opener.question : pair.question;
      try {
        scores[i] = await scoreAnswer(question, typeFor(i), pair.answer);
      } catch (err) {
        console.warn(`[live] could not score turn ${i} of ${session.id}:`, err);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SCORE_CONCURRENCY, pairs.length) }, worker),
  );

  let written = 0;
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    const answerScores = scores[i] ?? null;
    if (i === 0) {
      await repo.recordAnswer(session.id, 0, {
        transcript: pair.answer.trim(),
        answerScores,
      });
    } else {
      await repo.createTurn({
        sessionId: session.id,
        turnIndex: i,
        question: pair.question,
        questionType: typeFor(i),
        transcript: pair.answer.trim(),
        answerScores,
      });
    }
    written++;
  }
  return written;
}
