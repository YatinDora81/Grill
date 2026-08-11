"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerScores, QuestionFeedback, QuestionType, TranscriptWord } from "@repo/types";
import { scoreTone } from "@/components/ui";
import { Explain } from "@/components/Explain";
import { KaraokeTranscript } from "./KaraokeTranscript";
import { PlayAnswer, type PlayAnswerHandle } from "./PlayAnswer";
import { StarQuestion } from "./StarQuestion";
import { VideoPlayer } from "./VideoPlayer";

export interface ReplayTurn {
  turn_id: string;
  turn_index: number;
  question: string;
  question_type: QuestionType;
  transcript: string | null;
  transcript_words: TranscriptWord[] | null;
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
  readOnly = false,
}: {
  sessionId: string;
  turns: ReplayTurn[];
  /** Usually the report's best answer. Null when there isn't one. */
  defaultOpenIndex: number | null;
  readOnly?: boolean;
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
    const openTurn = (n: number) => setOpen((prev) => (prev.has(n) ? prev : new Set(prev).add(n)));

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

  // No `.rv`/`data-io` on the section, unlike most of the report: this is a
  // ReportNav jump target. `Reveal` unobserves after the first intersection, so a
  // jump into a section that has never been on screen would land on faded, offset
  // content — and on a report this long its threshold never fires for an element
  // this tall, which would leave the whole replay at opacity 0 for good.
  return (
    // No `.section` margin: the section head above this in page.tsx opens the
    // block, and a second gap between the head and its own accordion would read
    // as the rows belonging to nothing.
    <section>
      <div style={{ marginTop: 8 }}>
        {turns.map((t) => (
          <Turn
            key={t.turn_index}
            turn={t}
            sessionId={sessionId}
            isOpen={open.has(t.turn_index)}
            onToggle={() => toggle(t.turn_index)}
            readOnly={readOnly}
          />
        ))}
      </div>
    </section>
  );
}

function Turn({
  turn: t,
  sessionId,
  isOpen,
  onToggle,
  readOnly,
}: {
  turn: ReplayTurn;
  sessionId: string;
  isOpen: boolean;
  onToggle: () => void;
  readOnly: boolean;
}) {
  const n = t.turn_index + 1;

  const [seconds, setSeconds] = useState<number | null>(null);
  const playerRef = useRef<PlayAnswerHandle | null>(null);
  const onTime = useCallback((s: number | null) => setSeconds(s), []);
  const onSeek = useCallback((s: number) => playerRef.current?.seekTo(s), []);

  return (
    <div className="turn" id={`turn-${t.turn_index}`} data-open={isOpen}>
      <button type="button" className="turn-head" onClick={onToggle} aria-expanded={isOpen}>
        <span className="turn-n" aria-hidden="true">
          {String(n).padStart(2, "0")}
        </span>
        <span className="turn-q">{t.question}</span>
        <span className={"turn-type" + (t.question_type === "followup" ? " followup" : "")}>
          {TYPE_LABEL[t.question_type]}
        </span>
        {/* A square that says +/− rather than a rotating chevron: the
            row is one of a stack of squares, and the glyph states open
            or shut instead of implying a direction to travel in. */}
        <span
          className={
            "grid size-6 flex-none place-items-center border text-[0.8rem] leading-none transition-colors " +
            (isOpen ? "border-ember/40 text-ember" : "border-line text-ink-muted")
          }
          aria-hidden="true"
        >
          {isOpen ? "–" : "+"}
        </span>
      </button>

      {isOpen && (
        <div className="turn-body">
          <div>
            <p className="tr-label">You said</p>
            {t.transcript_words ? (
              <div className="mt-1.5 border-l-2 border-(--track-strong) pl-3">
                <KaraokeTranscript
                  words={t.transcript_words}
                  currentTime={seconds}
                  onSeek={t.has_audio ? onSeek : undefined}
                />
              </div>
            ) : (
              <p className="transcript">
                {t.transcript ? `“${t.transcript}”` : "No answer recorded."}
              </p>
            )}
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

          {t.has_audio || !readOnly ? (
            <div className="turn-actions">
              {t.has_audio ? (
                <PlayAnswer
                  sessionId={sessionId}
                  turnIndex={t.turn_index}
                  onTime={t.transcript_words ? onTime : undefined}
                  seekRef={playerRef}
                />
              ) : (
                <span className="mono-note">typed answer</span>
              )}
              {readOnly ? null : (
                <StarQuestion
                  turnId={t.turn_id}
                  questionHash={t.question_hash}
                  initial={t.starred}
                />
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
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
                <div
                  className="rub-f"
                  style={{ width: `${Math.max(0, Math.min(100, v * 10))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {/* Sibling of `.rubric`, not a child: that's a 5-column grid, so a note
          inside it would become a sixth cell and break the row. */}
      <Explain>
        These five judge <b>this answer alone</b>, out of ten — not the session score at the top of
        the page, which is out of a hundred. <b>Filler</b> runs the same way round as the rest: ten
        means you spoke clean. The colour is on the 0–100 scale used everywhere else, so a 7/10 is
        the same standing as a 70.
      </Explain>
    </div>
  );
}

/**
 * The coach's notes: numbered, scannable fixes rather than a bullet soup.
 * Numbering matters — "do 01 first" is a plan, a bullet list is a shrug.
 */
function Improvements({ items }: { items: string[] }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="coach">
      <p className="coach-h">
        <span>How to improve this answer</span>
        <em>{list.length === 1 ? "1 fix" : `${list.length} fixes`}</em>
      </p>
      <ol className="coach-list">
        {list.map((tip, i) => (
          <li key={i}>
            <b aria-hidden="true">{String(i + 1).padStart(2, "0")}</b>
            <span>{tip}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Model answers as cards you can lift: a labelled angle, the take itself under
 * an oversized quote mark, and a copy control — the whole point of a model
 * answer is taking it away to practise against.
 */
function PossibleAnswers({ items }: { items: string[] }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <div>
      <p className="tr-label">Possible answers</p>
      <div className="answers">
        {list.map((a, i) => (
          <div className="model" key={i}>
            <div className="model-top">
              <span className="model-tag">Angle {String(i + 1).padStart(2, "0")}</span>
              <CopyTake text={a} />
            </div>
            <p className="model-body">{a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Clipboard with a receipt. Failure stays quiet — there is nothing to fix. */
function CopyTake({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="underlink model-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard denied — the text is right there to select */
        }
      }}
    >
      {copied ? "copied ✓" : "copy"}
    </button>
  );
}
