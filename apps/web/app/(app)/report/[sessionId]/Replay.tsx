"use client";

import { useEffect, useState } from "react";
import type { AnswerScores, QuestionFeedback, QuestionType } from "@repo/types";
import { scoreTone } from "@/components/ui";
import { PlayAnswer } from "./PlayAnswer";
import { StarQuestion } from "./StarQuestion";
import { VideoPlayer } from "./VideoPlayer";

export interface ReplayTurn {
  turn_id: string;
  turn_index: number;
  question: string;
  question_type: QuestionType;
  transcript: string | null;
  has_audio: boolean;
  /** The session recording this answer is in, if there was a camera. */
  video_id: string | null;
  video_offset_ms: number | null;
  /** Days left on that recording, from SessionVideo.expiresAt. */
  video_expires_in_days: number | null;
  /** Computed server-side so the star paints correctly on first render. */
  question_hash: string;
  starred: boolean;
  feedback: QuestionFeedback | null;
  /** The per-answer rubric, absent on turns recorded before it existed. */
  scores: AnswerScores | null;
}

const TYPE_LABEL: Record<QuestionType, string> = {
  technical: "Technical",
  cultural: "Cultural",
  followup: "Follow-up",
  // Legacy turns: `behavioral` and `cultural` always meant the same thing.
  behavioral: "Cultural",
};

const RUBRIC_LABEL: Record<keyof AnswerScores, string> = {
  relevance: "relevance",
  correctness: "correctness",
  structure: "structure",
  depth: "depth",
  filler: "filler",
};

const TONE_CLASS = { strong: "tone-strong", mixed: "tone-mixed", weak: "tone-weak" } as const;

/**
 * The whole interview, in order: what was asked, what you actually said, how it
 * scored, what to do about it, and the tape.
 *
 * One accordion per turn, with the best answer open to start — the page is long
 * enough without eight transcripts unfurled, and the strongest answer is the one
 * worth landing on first.
 */
export function Replay({
  sessionId,
  turns,
  defaultOpenIndex,
}: {
  sessionId: string;
  turns: ReplayTurn[];
  /** Usually the report's best answer. Null when there isn't one. */
  defaultOpenIndex: number | null;
}) {
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(defaultOpenIndex !== null ? [defaultOpenIndex] : []),
  );

  /**
   * The "watch" links on the best/worst cards are `#turn-N` anchors. Opening the
   * turn they point at is what makes them do anything — the browser scrolls, we
   * unfold.
   *
   * Two listeners, because `hashchange` alone is not enough: once the URL
   * already ends in `#turn-3`, clicking that same link fires no event at all, so
   * a turn the reader collapsed by hand could never be reopened from the card.
   * The click listener catches the repeat; `hashchange` (and the initial read)
   * catches arriving with the anchor already in the URL.
   */
  useEffect(() => {
    const openTurn = (n: number) =>
      setOpen((prev) => (prev.has(n) ? prev : new Set(prev).add(n)));

    const fromHref = (href: string | null | undefined): number | null => {
      const m = /#turn-(\d+)$/.exec(href ?? "");
      return m ? Number(m[1]) : null;
    };

    const onHash = () => {
      const n = fromHref(window.location.hash);
      if (n !== null) openTurn(n);
    };
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.('a[href^="#turn-"]');
      const n = fromHref(anchor?.getAttribute("href"));
      if (n !== null) openTurn(n);
    };

    onHash();
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick);
    };
  }, []);

  if (!turns.length) return null;

  const toggle = (n: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  return (
    <section className="section rv" data-io>
      <p className="kicker">The replay — all {turns.length} questions</p>
      <div style={{ marginTop: 8 }}>
        {turns.map((t) => {
          const isOpen = open.has(t.turn_index);
          const n = t.turn_index + 1;
          return (
            <div className="turn" key={t.turn_index} id={`turn-${t.turn_index}`} data-open={isOpen}>
              <button
                type="button"
                className="turn-head"
                onClick={() => toggle(t.turn_index)}
                aria-expanded={isOpen}
              >
                <span className="turn-n" aria-hidden="true">
                  {String(n).padStart(2, "0")}
                </span>
                <span className="turn-q">{t.question}</span>
                <span
                  className={
                    "turn-type" + (t.question_type === "followup" ? " followup" : "")
                  }
                >
                  {TYPE_LABEL[t.question_type]}
                </span>
                <span className="chev" aria-hidden="true">
                  ›
                </span>
              </button>

              {isOpen && (
                <div className="turn-body">
                  <div>
                    <p className="tr-label">You said</p>
                    <p className="transcript">
                      {t.transcript ? `“${t.transcript}”` : "No answer recorded."}
                    </p>
                  </div>

                  {t.scores ? <Rubric scores={t.scores} /> : null}

                  <Improvements items={t.feedback?.improvements ?? []} />
                  <PossibleAnswers items={t.feedback?.possible_answers ?? []} />

                  {/* Only where a recording actually covers this answer. A denied
                      camera, or a session from before video existed, simply has
                      no player rather than a broken one. */}
                  {t.video_id && t.video_offset_ms !== null ? (
                    <VideoPlayer
                      videoId={t.video_id}
                      offsetMs={t.video_offset_ms}
                      turnNumber={n}
                      expiresInDays={t.video_expires_in_days}
                    />
                  ) : null}

                  <div className="turn-actions">
                    {t.has_audio ? (
                      <PlayAnswer sessionId={sessionId} turnIndex={t.turn_index} />
                    ) : (
                      <span className="mono-note">typed answer</span>
                    )}
                    <StarQuestion
                      turnId={t.turn_id}
                      questionHash={t.question_hash}
                      initial={t.starred}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Five mini-meters, scored out of ten. Tone is on the same 0–100 scale as
    everything else, so a 7/10 reads the same green a 70 does. */
function Rubric({ scores }: { scores: AnswerScores }) {
  const entries = Object.entries(RUBRIC_LABEL) as [keyof AnswerScores, string][];
  return (
    <div>
      <p className="tr-label" style={{ marginBottom: 8 }}>
        Rubric
      </p>
      <div className="rubric">
        {entries.map(([key, label]) => {
          const v = scores[key];
          return (
            <div key={key}>
              <p className="rub-k">{label}</p>
              <p className={`rub-v ${TONE_CLASS[scoreTone(v * 10)]}`}>
                {v}
                <small>/10</small>
              </p>
              <div className="rub-m">
                <div className="rub-f" style={{ width: `${Math.max(0, Math.min(100, v * 10))}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Improvements({ items }: { items: string[] }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="improve">
      <p className="tr-label">How to improve this answer</p>
      <ul>
        {list.map((tip, i) => (
          <li key={i}>{tip}</li>
        ))}
      </ul>
    </div>
  );
}

function PossibleAnswers({ items }: { items: string[] }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <div>
      <p className="tr-label">Possible answers</p>
      <div className="answers">
        {list.map((a, i) => (
          <div className="ans" key={i}>
            <p className="ans-tag">angle {String(i + 1).padStart(2, "0")}</p>
            <p>“{a}”</p>
          </div>
        ))}
      </div>
    </div>
  );
}
