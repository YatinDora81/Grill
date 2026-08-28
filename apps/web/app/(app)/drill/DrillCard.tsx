"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnswerScores,
  DrillAnswerResponse,
  DrillCardDTO,
  DrillGrade,
  DrillReviewResponse,
  QuestionType,
} from "@repo/types";
import { ApiClientError, apiPost, apiPostForm } from "@/lib/apiClient";
import { cx } from "@/components/ui";
import { useRecorder } from "@/hooks/useRecorder";

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

const GRADES: { grade: DrillGrade; label: string; blurb: string }[] = [
  { grade: 1, label: "Blanked", blurb: "back tomorrow" },
  { grade: 3, label: "Rough", blurb: "back soon" },
  { grade: 5, label: "Nailed it", blurb: "back much later" },
];

type Phase = "answering" | "sending" | "grading" | "reviewing";

const PANEL = "border border-line bg-paper-raised p-5 sm:p-6";
const EYEBROW = "font-mono text-[10.5px] tracking-[0.16em] uppercase text-ink-muted";

export function DrillCard({
  card,
  position,
  total,
  maxSeconds,
  maxBytes,
  onGraded,
}: {
  card: DrillCardDTO;
  position: number;
  total: number;
  maxSeconds: number;
  maxBytes: number;
  onGraded: (review: DrillReviewResponse) => void;
}) {
  const rec = useRecorder(maxSeconds);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("answering");
  const [result, setResult] = useState<DrillAnswerResponse | null>(null);
  const [error, setError] = useState("");
  const busy = phase === "sending" || phase === "grading";

  const send = useCallback(
    async (body: FormData | { card_id: string; text: string }) => {
      setPhase("sending");
      setError("");
      try {
        const res =
          body instanceof FormData
            ? await apiPostForm<DrillAnswerResponse>("/api/drill/answer", body)
            : await apiPost<DrillAnswerResponse>("/api/drill/answer", body);
        setResult(res);
        setPhase("reviewing");
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : "Couldn't score that answer.");
        setPhase("answering");
        rec.reset();
      }
    },
    [rec],
  );

  const finishRecording = useCallback(async () => {
    const blob = await rec.stop();
    if (!blob) {
      setError("Nothing was recorded — check the mic and try again.");
      rec.reset();
      return;
    }
    if (blob.size > maxBytes) {
      setError("That clip is too long to send. Keep a drill answer under a minute.");
      rec.reset();
      return;
    }
    const form = new FormData();
    form.append("card_id", card.id);
    form.append("audio", blob, "drill.webm");
    await send(form);
  }, [card.id, maxBytes, rec, send]);

  const capSubmit = useRef(finishRecording);
  capSubmit.current = finishRecording;
  useEffect(() => {
    if (rec.capped && phase === "answering") void capSubmit.current();
  }, [rec.capped, phase]);

  async function submitText() {
    if (!text.trim() || busy) return;
    await send({ card_id: card.id, text: text.trim() });
  }

  async function grade(value: DrillGrade) {
    if (busy) return;
    setPhase("grading");
    setError("");
    try {
      const review = await apiPost<DrillReviewResponse>("/api/drill/review", {
        card_id: card.id,
        grade: value,
        ...(result ? { transcript: result.transcript, answer_scores: result.answer_scores } : {}),
      });
      onGraded(review);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't save that grade.");
      setPhase("reviewing");
    }
  }

  return (
    <article className="mt-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        <p className={EYEBROW}>
          {String(position).padStart(2, "0")} / {String(total).padStart(2, "0")}
          <span className="ml-3 text-ink-soft">{TYPE_LABEL[card.question_type]}</span>
        </p>
        <p className={EYEBROW}>{schedule(card)}</p>
      </div>

      <h2 className="mt-3 font-display text-[1.5rem] leading-[1.15] font-extrabold tracking-[-0.01em] sm:text-[1.9rem]">
        {card.question}
      </h2>

      {card.best_transcript && phase === "answering" ? (
        <details className="mt-4 border-l-2 border-line pl-3">
          <summary className="cursor-pointer font-mono text-[10.5px] tracking-[0.16em] uppercase text-ink-muted">
            What you said last time
          </summary>
          <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-soft">{card.best_transcript}</p>
        </details>
      ) : null}

      {phase === "reviewing" && result ? (
        <Result result={result} onGrade={grade} busy={busy} />
      ) : (
        <div className="mt-6">
          {mode === "voice" ? (
            <VoicePanel
              rec={rec}
              busy={busy}
              max={maxSeconds}
              onStart={() => {
                setError("");
                void rec.start();
              }}
              onStop={() => void finishRecording()}
            />
          ) : (
            <TextPanel
              text={text}
              setText={setText}
              onSubmit={() => void submitText()}
              busy={busy}
            />
          )}

          <button
            type="button"
            className="mt-4 font-mono text-[10.5px] tracking-[0.16em] uppercase text-ink-muted underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-40"
            onClick={() => {
              setMode((m) => (m === "voice" ? "text" : "voice"));
              rec.reset();
              setError("");
            }}
            disabled={busy || rec.state === "recording"}
          >
            {mode === "voice" ? "Type it instead" : "Say it instead"}
          </button>
        </div>
      )}

      {error ? (
        <p className="error-note mt-5" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function schedule(card: DrillCardDTO): string {
  if (card.ahead) return "Ahead of schedule";
  if (card.repetitions === 0) return "First time back";
  return `Seen ${card.repetitions}×`;
}

function VoicePanel({
  rec,
  busy,
  max,
  onStart,
  onStop,
}: {
  rec: ReturnType<typeof useRecorder>;
  busy: boolean;
  max: number;
  onStart: () => void;
  onStop: () => void;
}) {
  const recording = rec.state === "recording";
  const left = Math.max(0, max - rec.seconds);

  if (!rec.supported) {
    return (
      <div className={PANEL}>
        <p className="text-[0.9rem] text-ink-soft">
          This browser can&rsquo;t record audio. Type the answer instead — it is scored exactly the
          same way.
        </p>
      </div>
    );
  }

  return (
    <div className={PANEL}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
        <button
          type="button"
          className={cx("btn", recording ? "btn-danger" : "btn-primary")}
          onClick={recording ? onStop : onStart}
          disabled={busy || rec.state === "requesting"}
        >
          {busy
            ? "Scoring…"
            : recording
              ? "Stop and score"
              : rec.state === "requesting"
                ? "Asking for the mic…"
                : "Answer out loud"}
        </button>

        <p className="font-mono text-[11px] tracking-[0.08em] tabular text-ink-muted">
          {recording ? `${fmtTime(rec.seconds)} · ${fmtTime(left)} left` : `${fmtTime(max)} max`}
        </p>
      </div>

      <div
        className="mt-4 h-1 border border-line bg-paper-sunken"
        role="presentation"
        aria-hidden="true"
      >
        <div
          className="h-full bg-ember transition-[width] duration-75"
          style={{ width: `${Math.round((recording ? rec.level : 0) * 100)}%` }}
        />
      </div>

      {rec.error ? <p className="mono-note mono-note-error mt-3">{rec.error}</p> : null}
      {rec.capped ? <p className="mono-note mt-3">Time&rsquo;s up — sending that take.</p> : null}
    </div>
  );
}

function TextPanel({
  text,
  setText,
  onSubmit,
  busy,
}: {
  text: string;
  setText: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className={PANEL}>
      <label className="label" htmlFor="drill-answer">
        Your answer
      </label>
      <textarea
        id="drill-answer"
        className="input area mt-2"
        rows={5}
        maxLength={20_000}
        value={text}
        disabled={busy}
        placeholder="Say it the way you would say it out loud."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSubmit();
        }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSubmit}
          disabled={busy || !text.trim()}
        >
          {busy ? "Scoring…" : "Score this answer"}
        </button>
        <span className="mono-note">⌘↵ to send</span>
      </div>
    </div>
  );
}

function Result({
  result,
  onGrade,
  busy,
}: {
  result: DrillAnswerResponse;
  onGrade: (grade: DrillGrade) => void;
  busy: boolean;
}) {
  return (
    <div className="mt-6">
      <div className={PANEL}>
        <p className={EYEBROW}>What you said</p>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">{result.transcript}</p>

        <div className="rubric mt-5">
          {(Object.keys(RUBRIC_LABEL) as (keyof AnswerScores)[]).map((k) => (
            <div key={k}>
              <p className="rub-k">{RUBRIC_LABEL[k]}</p>
              <p className="rub-v">
                {result.answer_scores[k]}
                <small>/10</small>
              </p>
              <div className="rub-m">
                <div className="rub-f" style={{ width: `${result.answer_scores[k] * 10}%` }} />
              </div>
            </div>
          ))}
        </div>

        {result.improvements.length > 0 || result.better_line ? (
          <div className="mt-5 border-t border-line pt-4">
            {result.improvements.length > 0 ? (
              <ul className="grid gap-2">
                {result.improvements.map((line) => (
                  <li key={line} className="text-[0.9rem] leading-relaxed text-ink-soft">
                    — {line}
                  </li>
                ))}
              </ul>
            ) : null}
            {result.better_line ? (
              <p className="mt-3 border-l-2 border-ember pl-3 text-[0.95rem] leading-relaxed text-ink">
                {result.better_line}
              </p>
            ) : null}
          </div>
        ) : null}

        {result.previous_best ? (
          <details className="mt-5 border-t border-line pt-4">
            <summary className={cx("cursor-pointer", EYEBROW)}>Your best answer so far</summary>
            <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-soft">
              {result.previous_best}
            </p>
          </details>
        ) : null}
      </div>

      <p className="mt-6 text-[0.95rem] text-ink-soft">
        Now the only question that matters:{" "}
        <b className="font-medium text-ink">did you actually know it?</b>
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {GRADES.map((g) => (
          <button
            key={g.grade}
            type="button"
            className={cx(
              "border p-4 text-left transition-colors disabled:opacity-40",
              g.grade === result.suggested_grade
                ? "border-ember text-ink"
                : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
            )}
            onClick={() => onGrade(g.grade)}
            disabled={busy}
          >
            <span className="block font-mono text-[11px] tracking-[0.14em] uppercase">
              {g.label}
            </span>
            <span className="mono-note mt-1 block">{g.blurb}</span>
          </button>
        ))}
      </div>
      <p className="mono-note mt-3">
        {busy ? "Saving…" : "Highlighted is what the scores suggest — you decide."}
      </p>
    </div>
  );
}

function fmtTime(total: number): string {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
