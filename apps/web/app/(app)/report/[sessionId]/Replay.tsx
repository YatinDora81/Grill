"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnswerScores,
  AwaySegment,
  QuestionFeedback,
  QuestionType,
  StarBreakdown,
  TranscriptWord,
} from "@repo/types";
import { scoreTone } from "@/components/ui";
import { Explain } from "@/components/Explain";
import { AddToDrill } from "./AddToDrill";
import { AwayStrip } from "./AwayStrip";
import { KaraokeTranscript } from "./KaraokeTranscript";
import { PlayAnswer, type PlayAnswerHandle } from "./PlayAnswer";
import { StarBar } from "./StarBar";
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
  video_id: string | null;
  video_offset_ms: number | null;
  video_expires_in_days: number | null;
  question_hash: string;
  starred: boolean;
  feedback: QuestionFeedback | null;
  scores: AnswerScores | null;
  star: StarBreakdown | null;
  away_segments: AwaySegment[] | null;
  take_ms: number | null;
}

const TYPE_LABEL: Record<QuestionType, string> = {
  technical: "Technical",
  cultural: "Cultural",
  followup: "Follow-up",
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

export function Replay({
  sessionId,
  turns,
  defaultOpenIndex,
  readOnly = false,
}: {
  sessionId: string;
  turns: ReplayTurn[];
  defaultOpenIndex: number | null;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(defaultOpenIndex !== null ? [defaultOpenIndex] : []),
  );

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

  return (
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

            {t.away_segments && t.take_ms ? (
              <AwayStrip
                segments={t.away_segments}
                totalMs={t.take_ms}
                onSeek={t.has_audio ? onSeek : undefined}
              />
            ) : null}
          </div>

          {t.scores ? <Rubric scores={t.scores} /> : null}

          <StarBar breakdown={t.star} />

          <Improvements items={t.feedback?.improvements ?? []} />
          <PossibleAnswers items={t.feedback?.possible_answers ?? []} />

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
                  scrubber
                />
              ) : (
                <span className="mono-note">typed answer</span>
              )}
              {readOnly ? null : (
                <>
                  <StarQuestion
                    turnId={t.turn_id}
                    questionHash={t.question_hash}
                    initial={t.starred}
                  />
                  <AddToDrill turnId={t.turn_id} />
                </>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

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
      <Explain>
        These five judge <b>this answer alone</b>, out of ten — not the session score at the top of
        the page, which is out of a hundred. <b>Filler</b> runs the same way round as the rest: ten
        means you spoke clean. The colour is on the 0–100 scale used everywhere else, so a 7/10 is
        the same standing as a 70.
      </Explain>
    </div>
  );
}

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
        } catch {}
      }}
    >
      {copied ? "copied ✓" : "copy"}
    </button>
  );
}
