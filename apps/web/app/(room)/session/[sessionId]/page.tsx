import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { QuestionType, TurnPayload, TurnState } from "@repo/types";
import { getUserId } from "@/lib/auth";
import { config } from "@/lib/env";
import * as repo from "@/lib/db/repo";
import { toSessionContext } from "@/lib/services/sessionContext";
import { followUp, questionInputs } from "@/lib/services/questionService";
import {
  CODING_ANSWER_CAP_S,
  DESIGN_ANSWER_CAP_S,
  payloadOf,
  planNextCodingTurn,
} from "@/lib/services/codingService";
import { HotSeat } from "./HotSeat";
import { CodeSeat } from "./CodeSeat";

export const metadata: Metadata = {
  title: "Interview",
  description: "The hot seat — one question at a time, follow-ups included.",
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const userId = await getUserId();
  if (!userId) redirect(`/?auth=login&next=/session/${sessionId}`);

  const session = await repo.getSession(sessionId, userId);
  if (!session) redirect("/dashboard");

  if (session.status === "completed") redirect(`/report/${sessionId}`);
  if (session.status !== "in_progress") redirect("/dashboard");

  const ctx = toSessionContext(session);
  const role = session.role;
  const name = session.name;
  const turns = await repo.getTurns(sessionId);
  const state: TurnState[] = turns.map((t) => ({
    turn_index: t.turnIndex,
    question: t.question,
    question_type: t.questionType,
    transcript: t.transcript,
    has_audio: Boolean(t.audioKey),
    payload: payloadOf(t),
  }));

  const numQuestions = ctx.config.num_questions;
  const maxSeconds = ctx.config.max_answer_seconds ?? config.audio.maxSeconds;
  const current = state.find((t) => t.transcript === null);

  if (!current) {
    if (state.length >= numQuestions) redirect(`/report/${sessionId}?finish=1`);

    if (session.retryOfId) redirect(`/report/${sessionId}?finish=1`);

    const nextIndex = state.length;

    if (ctx.config.round === "coding" || ctx.config.round === "design") {
      const planned =
        ctx.config.round === "coding"
          ? await planNextCodingTurn(ctx, turns, userId)
          : await planNextDesignTurn(ctx, turns, userId);
      if (!planned) redirect(`/report/${sessionId}?finish=1`);
      try {
        await repo.createTurn({
          sessionId,
          turnIndex: nextIndex,
          question: planned.question,
          questionType: planned.questionType,
          questionPayload: planned.payload,
        });
      } catch {
        const raced = await repo.getTurn(sessionId, nextIndex);
        if (!raced) throw new Error("could not recover the next question");
        return renderSeat(raced.question, raced.questionType, nextIndex, payloadOf(raced));
      }
      return renderSeat(planned.question, planned.questionType, nextIndex, planned.payload);
    }

    const history = turns
      .filter((t) => t.transcript !== null)
      .map((t) => ({ question: t.question, answer: t.transcript ?? "" }));
    const next = await followUp(
      ctx,
      history,
      numQuestions - (nextIndex + 1),
      await questionInputs(ctx, userId),
    );
    try {
      await repo.createTurn({
        sessionId,
        turnIndex: nextIndex,
        question: next.question,
        questionType: next.question_type,
      });
    } catch {
      const raced = await repo.getTurn(sessionId, nextIndex);
      if (!raced) throw new Error("could not recover the next question");
      return renderSeat(raced.question, raced.questionType, nextIndex, payloadOf(raced));
    }
    return renderSeat(next.question, next.question_type, nextIndex, null);
  }

  return renderSeat(
    current.question,
    current.question_type,
    current.turn_index,
    current.payload ?? null,
  );

  function renderSeat(
    question: string,
    questionType: QuestionType,
    turnIndex: number,
    payload: TurnPayload | null,
  ) {
    const answered = state.filter((t) => t.transcript !== null).length;

    if (payload?.kind === "coding") {
      return (
        <CodeSeat
          key={turnIndex}
          sessionId={sessionId}
          name={name}
          role={role}
          numQuestions={numQuestions}
          answered={answered}
          turnIndex={turnIndex}
          payload={{ ...payload, hidden_tests: [] }}
          maxSeconds={CODING_ANSWER_CAP_S}
          maxBytes={config.audio.maxBytes}
          persona={ctx.config.persona ?? null}
          videoBitrate={config.video.bitsPerSecond}
        />
      );
    }


    return (
      <HotSeat
        key={turnIndex}
        sessionId={sessionId}
        name={name}
        role={role}
        numQuestions={numQuestions}
        answered={answered}
        turnIndex={turnIndex}
        question={question}
        questionType={questionType}
        maxSeconds={maxSeconds}
        maxBytes={config.audio.maxBytes}
        persona={ctx.config.persona ?? null}
        videoBitrate={config.video.bitsPerSecond}
      />
    );
  }
}
