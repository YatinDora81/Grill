import "server-only";
import type { Session } from "@repo/db";
import type { AnswerResponse, TranscriptWord } from "@repo/types";
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
}

/**
 * Shared per-answer logic (Grill §hot loop): score the answer, persist the
 * turn, and — unless the question count is reached — generate the next question.
 * Conversation memory is rebuilt from the DB each turn (restart-proof).
 */
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
  });

  const answered = turnIndex + 1;
  const done = answered >= numQuestions;

  if (done) {
    return {
      turn_index: turnIndex,
      transcript: input.transcript,
      answer_scores: answerScores,
      next_question: null,
      next_question_type: null,
      done: true,
    };
  }

  const turns = await repo.getTurns(session.id);
  const nextIndex = turnIndex + 1;

  // A retry's questions were copied up front and must not change — the whole
  // point is that both runs face identical material, so generating here would
  // destroy the comparison. Just hand back the one already sitting there.
  if (session.retryOfId) {
    const existing = turns.find((t) => t.turnIndex === nextIndex);
    if (!existing) {
      // Fewer copied questions than num_questions says: trust the questions,
      // not the count, and end the run rather than inventing one.
      return {
        turn_index: turnIndex,
        transcript: input.transcript,
        answer_scores: answerScores,
        next_question: null,
        next_question_type: null,
        done: true,
      };
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
