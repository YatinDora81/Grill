"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DrillCardDTO, DrillQueueResponse, DrillReviewResponse } from "@repo/types";
import { ApiClientError, apiGet } from "@/lib/apiClient";
import { cx } from "@/components/ui";
import { DrillCard } from "./DrillCard";

const EYEBROW = "font-mono text-[10.5px] tracking-[0.16em] uppercase text-ink-muted";
const STAT = "border-r border-b border-line p-5";

export function DrillDeck({
  initial,
  needsTimezone,
  maxSeconds,
  maxBytes,
}: {
  initial: DrillQueueResponse;
  needsTimezone: boolean;
  maxSeconds: number;
  maxBytes: number;
}) {
  const [cards, setCards] = useState<DrillCardDTO[]>(initial.cards);
  const [index, setIndex] = useState(0);
  const [streak, setStreak] = useState(initial.streak_days);
  const [dueTotal, setDueTotal] = useState(initial.due_total);
  const [reviewedToday, setReviewedToday] = useState(initial.reviewed_today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exhausted, setExhausted] = useState(false);

  useReportedTimezone(needsTimezone);

  const card = cards[index] ?? null;
  const done = card === null;

  function onGraded(review: DrillReviewResponse) {
    setStreak(review.streak_days);
    setReviewedToday((n) => n + 1);
    if (card && !card.ahead) setDueTotal((n) => Math.max(0, n - 1));
    setIndex((i) => i + 1);
  }

  async function more() {
    setLoading(true);
    setError("");
    try {
      const seen = cards.map((c) => c.id).join(",");
      const next = await apiGet<DrillQueueResponse>(
        `/api/drill${seen ? `?exclude=${encodeURIComponent(seen)}` : ""}`,
      );
      setStreak(next.streak_days);
      setDueTotal(next.due_total);
      setReviewedToday(next.reviewed_today);
      if (next.cards.length === 0) {
        setExhausted(true);
        return;
      }
      setCards((cur) => [...cur, ...next.cards]);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't load more cards.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="mt-8 grid grid-cols-3 border-t border-l border-line">
        <Stat
          k="Streak"
          v={streak === 0 ? "—" : String(streak)}
          note={streak === 1 ? "day" : "days"}
        />
        <Stat k="Due now" v={String(dueTotal)} note={dueTotal === 1 ? "question" : "questions"} />
        <Stat
          k="Done today"
          v={String(reviewedToday)}
          note={reviewedToday === 1 ? "answer" : "answers"}
        />
      </div>

      {card ? (
        <DrillCard
          key={card.id}
          card={card}
          position={index + 1}
          total={cards.length}
          maxSeconds={maxSeconds}
          maxBytes={maxBytes}
          onGraded={onGraded}
        />
      ) : (
        <Finished
          reviewedToday={reviewedToday}
          streak={streak}
          exhausted={exhausted}
          loading={loading}
          started={cards.length > 0}
          onMore={() => void more()}
        />
      )}

      {error ? (
        <p className="error-note mt-5" role="alert">
          {error}
        </p>
      ) : null}

      {!done && cards.length > 1 ? (
        <p className={cx(EYEBROW, "mt-8")}>{cards.length - index - 1} more after this one</p>
      ) : null}
    </>
  );
}

function Stat({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className={STAT}>
      <p className="font-mono text-[0.56rem] tracking-[0.18em] uppercase text-ink-muted">{k}</p>
      <p className="mt-2 font-mono text-[1.35rem] leading-none font-semibold tabular">
        {v}
        <small className="ml-1 text-[0.5em] font-normal text-ink-muted">{note}</small>
      </p>
    </div>
  );
}

function Finished({
  reviewedToday,
  streak,
  exhausted,
  loading,
  started,
  onMore,
}: {
  reviewedToday: number;
  streak: number;
  exhausted: boolean;
  loading: boolean;
  started: boolean;
  onMore: () => void;
}) {
  const nothingToDo = !started && reviewedToday === 0;

  return (
    <section className="mt-9 border border-line bg-paper-raised p-6 sm:p-8">
      <p className={EYEBROW}>{nothingToDo ? "Nothing due" : "Deck clear"}</p>
      <h2 className="mt-3 max-w-[22ch] font-display text-[1.6rem] leading-[1.1] font-extrabold tracking-[-0.01em] uppercase">
        {nothingToDo
          ? "Nothing is due yet."
          : streak > 1
            ? `${streak} days running.`
            : "That's today done."}
      </h2>
      <p className="mt-3 max-w-[52ch] text-[0.95rem] leading-relaxed text-ink-soft">
        {nothingToDo ? (
          <>
            Cards are seeded from the answers that went badly, and from anything you star on a
            report. Sit an interview and the deck fills itself.
          </>
        ) : (
          <>
            <b className="font-medium text-ink">
              {reviewedToday} answer{reviewedToday === 1 ? "" : "s"}
            </b>{" "}
            today. The rest come back on their own schedule — that is the whole point of drilling
            rather than re-reading.
          </>
        )}
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {exhausted ? (
          <p className="mono-note">
            Nothing left in the deck. Come back tomorrow, or sit an interview to seed more.
          </p>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={onMore} disabled={loading}>
            {loading ? "Looking…" : "Drill more"}
          </button>
        )}
        <Link href="/dashboard" className="btn btn-ghost">
          Back to dashboard
        </Link>
      </div>
    </section>
  );
}

function useReportedTimezone(needed: boolean): void {
  const sent = useRef(false);
  useEffect(() => {
    if (!needed || sent.current) return;
    sent.current = true;

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timezone) return;

    void fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone }),
    }).catch((err) => {
      console.warn("[drill] could not report the browser timezone:", err);
    });
  }, [needed]);
}
