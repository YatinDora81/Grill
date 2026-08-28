import "server-only";
import type { Session } from "@repo/db";
import type { AnswerResponse, CameraTurnMetrics, TranscriptWord } from "@repo/types";
import { badRequest, conflict } from "@/lib/errors";
import * as repo from "@/lib/db/repo";
import { scoreAnswer } from "./evaluationService";
import { followUp, questionInputs } from "./questionService";
import { toSessionContext } from "./sessionContext";

export interface AnswerInput {
  session: Session;
  turnIndex: number;
  transcript: string;
  words?: TranscriptWord[] | null;
  audioKey?: string | null;
  videoId?: string | null;
  videoOffsetMs?: number | null;
  cameraMetrics?: CameraTurnMetrics | null;
}

export async function processAnswer(input: AnswerInput): Promise<AnswerResponse> {
  const { session, turnIndex } = input;

  if (session.status !== "in_progress") {
    throw conflict(`Session is ${session.status}, not accepting answers.`, "session_not_active");
  }

  const ctx = toSessionContext(session);
  const numQuestions = ctx.config.num_questions;

  const turn = await repo.getTurn(session.id, turnIndex);
  if (!turn) throw badRequest(`No question at turn_index ${turnIndex}.`, "unknown_turn");
  if (turn.transcript) {
    throw conflict(`Turn ${turnIndex} was already answered.`, "turn_already_answered");
  }

  const answerScores = await scoreAnswer(turn.question, turn.questionType, input.transcript);

  await repo.recordAnswer(session.id, turnIndex, {
    transcript: input.transcript,
    transcriptWords: input.words ?? null,
    audioKey: input.audioKey ?? null,
    answerScores,
    videoId: input.videoId ?? null,
    videoOffsetMs: input.videoOffsetMs ?? null,
    cameraMetrics: input.cameraMetrics ?? null,
  });

  const finish = async (): Promise<AnswerResponse> => {
    await repo.setStatus(session.id, "generating_report");
    return {
      turn_index: turnIndex,
      transcript: input.transcript,
      answer_scores: answerScores,
      next_question: null,
      next_question_type: null,
      done: true,
    };
  };

  const answered = turnIndex + 1;
  if (answered >= numQuestions) return finish();

  const turns = await repo.getTurns(session.id);
  const nextIndex = turnIndex + 1;

  if (session.retryOfId || session.questionSetId) {
    const existing = turns.find((t) => t.turnIndex === nextIndex);
    if (!existing) {
      return finish();
    }
    return {
      turn_index: turnIndex,
      transcript: input.transcript,
      answer_scores: answerScores,
      next_question: existing.question,
      next_question_type: existing.questionType,
      done: false,
    };
  }

  const history = turns
    .filter((t) => t.transcript !== null)
    .map((t) => ({ question: t.question, answer: t.transcript ?? "" }));

  const next = await followUp(
    ctx,
    history,
    numQuestions - (nextIndex + 1),
    await questionInputs(ctx, session.userId),
  );

  await repo.createTurn({
    sessionId: session.id,
    turnIndex: nextIndex,
    question: next.question,
    questionType: next.question_type,
  });

  return {
    turn_index: turnIndex,
    transcript: input.transcript,
    answer_scores: answerScores,
    next_question: next.question,
    next_question_type: next.question_type,
    done: false,
  };
}
