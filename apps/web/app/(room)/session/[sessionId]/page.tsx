import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { QuestionType, TurnState } from "@repo/types";
import { getUserId } from "@/lib/auth";
import { config } from "@/lib/env";
import * as repo from "@/lib/db/repo";
import { toSessionContext } from "@/lib/services/sessionContext";
import { followUp, questionInputs } from "@/lib/services/questionService";
import { HotSeat } from "./HotSeat";

export const metadata: Metadata = {
  title: "Interview",
  description: "The hot seat — one question at a time, follow-ups included.",
  // (room) has no layout of its own, so unlike the (app) group this restates the
  // noindex itself rather than inheriting it from one.
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

/**
 * Reads the session straight from the DB rather than via fetch, so a reload
 * mid-interview lands you back on the right question instead of a blank room.
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const userId = await getUserId();
  if (!userId) redirect(`/?auth=login&next=/session/${sessionId}`);

  // User-scoped: someone else's session id is simply "not found".
  const session = await repo.getSession(sessionId, userId);
  if (!session) redirect("/dashboard");

  // A finished session has a report to read, not questions to answer.
  if (session.status === "completed") redirect(`/report/${sessionId}`);
  if (session.status !== "in_progress") redirect("/dashboard");

  const ctx = toSessionContext(session);
  // Read off the narrowed values here: renderSeat below is a nested function, so
  // TS can't carry the `if (!session)` narrowing into it.
  const role = session.role;
  const name = session.name;
  const turns = await repo.getTurns(sessionId);
  const state: TurnState[] = turns.map((t) => ({
    turn_index: t.turnIndex,
    question: t.question,
    question_type: t.questionType,
    transcript: t.transcript,
    has_audio: Boolean(t.audioKey),
  }));

  const numQuestions = ctx.config.num_questions;
  // The cap this interview was created with, not today's model. A session
  // predating the field has none — those fall back to the flat env default,
  // which is exactly the limit they were recorded under.
  const maxSeconds = ctx.config.max_answer_seconds ?? config.audio.maxSeconds;
  const current = state.find((t) => t.transcript === null);

  if (!current) {
    // Every question answered and the count is met, but /end never ran (e.g.
    // the tab died): finish it.
    if (state.length >= numQuestions) redirect(`/report/${sessionId}?finish=1`);

    // A retry's questions are copied up front and never generated. Nothing left
    // to answer means it's over, however few questions the parent had — writing
    // a new one here would break the very comparison the retry exists for.
    if (session.retryOfId) redirect(`/report/${sessionId}?finish=1`);

    // Short of the question count with nothing left to answer means the last
    // answer saved but its follow-up never did — processAnswer records the
    // answer before it writes the next question, so an LLM failure in between
    // strands the session here. Rebuild the missing question; the alternative
    // is silently ending someone's interview at question 2 of 8.
    const history = turns
      .filter((t) => t.transcript !== null)
      .map((t) => ({ question: t.question, answer: t.transcript ?? "" }));
    const nextIndex = state.length;
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
      // Two tabs recovered at once and the other won the (sessionId, turnIndex)
      // unique index. Its question is just as good — take it.
      const raced = await repo.getTurn(sessionId, nextIndex);
      if (!raced) throw new Error("could not recover the next question");
      return renderSeat(raced.question, raced.questionType, nextIndex);
    }
    return renderSeat(next.question, next.question_type, nextIndex);
  }

  return renderSeat(current.question, current.question_type, current.turn_index);

  function renderSeat(question: string, questionType: QuestionType, turnIndex: number) {
    return (
      <HotSeat
        // Keyed on the turn: HotSeat holds the question in state, so a
        // router.refresh() after a stale-view resync must remount it rather
        // than leave the old turn's state in place.
        key={turnIndex}
        sessionId={sessionId}
        name={name}
        role={role}
        numQuestions={numQuestions}
        answered={state.filter((t) => t.transcript !== null).length}
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
