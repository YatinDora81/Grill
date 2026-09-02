import "server-only";
import type { Session } from "@repo/db";
import type {
  AnswerResponse,
  AnswerScores,
  CameraTurnMetrics,
  CodeSubmission,
  DesignReview,
  TranscriptWord,
} from "@repo/types";
import { badRequest, conflict } from "@/lib/errors";
import * as repo from "@/lib/db/repo";
import { responseLatencyMs as latencyFor } from "@/lib/live/turnTaking";
import { payloadOf, planNextCodingTurn } from "./codingService";
import { planNextDesignTurn } from "./designService";
import { scoreAnswer } from "./evaluationService";
import { followUp, questionInputs } from "./questionService";
import { toSessionContext } from "./sessionContext";

export interface AnswerInput {
  session: Session;
  turnIndex: number;
  transcript: string;
  words?: TranscriptWord[] | null;
  transcriptConfidence?: number | null;
  audioKey?: string | null;
  videoId?: string | null;
  videoOffsetMs?: number | null;
  cameraMetrics?: CameraTurnMetrics | null;
  answerOffsetMs?: number | null;
  interruptedAtS?: number | null;
  answerScores?: AnswerScores;
  codeSubmission?: CodeSubmission | null;
  designReview?: DesignReview | null;
  designKey?: string | null;
  designImageKey?: string | null;
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

  const answerScores =
    input.answerScores ?? (await scoreAnswer(turn.question, turn.questionType, input.transcript));

  const spokenTurn = !input.codeSubmission && !input.designReview;
  const responseLatencyMs = spokenTurn
    ? latencyFor(input.answerOffsetMs, input.words?.[0]?.start)
    : null;

  await repo.recordAnswer(session.id, turnIndex, {
    transcript: input.transcript,
    transcriptWords: input.words ?? null,
    transcriptConfidence: input.transcriptConfidence ?? null,
    audioKey: input.audioKey ?? null,
    answerScores,
    videoId: input.videoId ?? null,
    videoOffsetMs: input.videoOffsetMs ?? null,
    cameraMetrics: input.cameraMetrics ?? null,
    responseLatencyMs,
    interruptedAtS: input.interruptedAtS ?? null,
    codeSubmission: input.codeSubmission ?? null,
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
      next_payload: payloadOf(existing),
      done: false,
    };
  }

  if (ctx.config.round === "coding" || ctx.config.round === "design") {
    const planned =
      ctx.config.round === "coding"
        ? await planNextCodingTurn(ctx, turns, session.userId)
        : await planNextDesignTurn(ctx, turns, session.userId);
    if (!planned) return finish();
    await repo.createTurn({
      sessionId: session.id,
      turnIndex: nextIndex,
      question: planned.question,
      questionType: planned.questionType,
      questionPayload: planned.payload,
    });
    return {
      turn_index: turnIndex,
      transcript: input.transcript,
      answer_scores: answerScores,
      next_question: planned.question,
      next_question_type: planned.questionType,
      next_payload: planned.payload,
      done: false,
    };
  }

  const history = turns
    .filter((t) => t.transcript !== null)
    .map((t) => ({ question: t.question, answer: t.transcript ?? "" }));

  const next = await followUp(ctx, history, numQuestions - (nextIndex + 1), {
    ...(await questionInputs(ctx, session.userId)),
    lastAnswerInterruptedAtS: input.interruptedAtS ?? undefined,
  });

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
