"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { AnswerResponse, EndResponse, QuestionType } from "@repo/types";
import { apiPost, apiPostForm, ApiClientError } from "@/lib/apiClient";
import { cx } from "@/components/ui";
import { GrillToaster } from "@/components/toast";
import { useSpeech } from "@/hooks/useSpeech";
import { useRecorder } from "./useRecorder";
import { Interviewer } from "./Interviewer";
import { SelfView, CameraToggle } from "./SelfView";

interface Props {
  sessionId: string;
  role: string | null;
  numQuestions: number;
  answered: number;
  turnIndex: number;
  question: string;
  questionType: QuestionType;
  maxSeconds: number;
  maxBytes: number;
}

type Phase = "answering" | "sending" | "finishing";

/** The question's entrance runs 0.55s; the voice comes in just behind it. */
const SPEAK_DELAY_MS = 500;

/**
 * Codes that mean "your view of this interview is behind the server's", not
 * "you did something wrong". Retrying is pointless; re-reading state is the fix.
 */
const STALE_CODES = new Set(["turn_already_answered", "unknown_turn", "session_not_active"]);

function isStale(err: unknown): boolean {
  return err instanceof ApiClientError && STALE_CODES.has(err.code);
}

const TYPE_LABEL: Record<QuestionType, string> = {
  technical: "Technical",
  cultural: "Cultural",
  followup: "Follow-up",
  // Legacy turns only — nothing writes `behavioral` any more, but old sessions
  // still carry it and it always meant the same thing as cultural.
  behavioral: "Cultural",
};

export function HotSeat(props: Props) {
  const router = useRouter();
  const rec = useRecorder(props.maxSeconds);
  const speech = useSpeech();

  const [turnIndex, setTurnIndex] = useState(props.turnIndex);
  const [question, setQuestion] = useState(props.question);
  const [questionType, setQuestionType] = useState<QuestionType>(props.questionType);
  const [answered, setAnswered] = useState(props.answered);

  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("answering");
  const [error, setError] = useState("");
  const [cameraOn, setCameraOn] = useState(false);

  const busy = phase !== "answering";

  // Read each new question aloud, a beat after it lands — speaking over the
  // question's own entrance animation makes both feel rushed. `speak` is
  // referentially stable, so this fires on the question text alone, not when
  // the voice list arrives or mute toggles (either would restart it mid-word).
  const { speak, stop: stopSpeaking } = speech;
  useEffect(() => {
    const t = setTimeout(() => speak(question), SPEAK_DELAY_MS);
    return () => clearTimeout(t);
  }, [question, speak]);

  /** Never let the interviewer talk over the answer. */
  function startRecording() {
    stopSpeaking();
    rec.start();
  }

  /** Shared tail: advance to the next question, or wrap the interview up. */
  async function afterAnswer(res: AnswerResponse) {
    setAnswered((n) => n + 1);
    if (!res.done && res.next_question) {
      setTurnIndex(res.turn_index + 1);
      setQuestion(res.next_question);
      setQuestionType(res.next_question_type ?? "technical");
      setText("");
      rec.reset();
      setPhase("answering");
      return;
    }
    // Last answer in: build the report. This is the slow call.
    setPhase("finishing");
    try {
      await apiPost<EndResponse>("/api/interview/end", {
        session_id: props.sessionId,
      });
    } catch (err) {
      // The report may still exist (or be retryable) — the report page handles
      // both, so send them there rather than trapping them in the room.
      if (!(err instanceof ApiClientError) || err.code !== "report_in_progress") {
        setError(err instanceof ApiClientError ? err.message : "Couldn't build the report.");
      }
    }
    router.push(`/report/${props.sessionId}`);
  }

  /**
   * Scoring an answer and writing the next question takes ten seconds or more.
   * The toast is the only thing standing between the user and a screen that
   * looks broken, so it stays up for the whole round trip.
   */
  function track(work: Promise<void>, failure: string): Promise<void> {
    return toast.promise(work, {
      loading: "Sending your answer…",
      success: "Answer in — next question coming up",
      error: (err: unknown) =>
        isStale(err)
          ? "You're already past this one — catching up…"
          : err instanceof ApiClientError
            ? err.message
            : failure,
    });
  }

  /**
   * The server has moved on without us: the answer landed but its response
   * never made it back, so this tab is showing a question that's already been
   * answered. Re-submitting can only ever fail. Pull the real state instead —
   * the page is `force-dynamic` and HotSeat is keyed on the server's turn
   * index, so a refresh remounts us on the actual current question.
   */
  function resync(): void {
    setError("");
    rec.reset();
    setPhase("answering");
    router.refresh();
  }

  async function submitText() {
    if (!text.trim() || busy) return;
    setPhase("sending");
    setError("");
    const send = async () => {
      const res = await apiPost<AnswerResponse>("/api/interview/answer-text", {
        session_id: props.sessionId,
        turn_index: turnIndex,
        text: text.trim(),
      });
      await afterAnswer(res);
    };
    try {
      await track(send(), "Couldn't send that answer.");
    } catch (err) {
      if (isStale(err)) return resync();
      setError(err instanceof ApiClientError ? err.message : "Couldn't send that answer.");
      setPhase("answering");
    }
  }

  async function finishRecording() {
    const blob = await rec.stop();
    if (!blob) {
      setError("Nothing was recorded. Try again, or type your answer.");
      rec.reset();
      return;
    }
    if (blob.size > props.maxBytes) {
      setError("That answer is too long to upload. Keep it a bit shorter.");
      rec.reset();
      return;
    }
    setPhase("sending");
    setError("");
    const send = async () => {
      const form = new FormData();
      form.append("session_id", props.sessionId);
      form.append("turn_index", String(turnIndex));
      form.append("audio", blob, `turn_${turnIndex}.webm`);
      const res = await apiPostForm<AnswerResponse>("/api/interview/answer", form);
      await afterAnswer(res);
    };
    try {
      await track(send(), "Couldn't send that recording.");
    } catch (err) {
      if (isStale(err)) return resync();
      setError(err instanceof ApiClientError ? err.message : "Couldn't send that recording.");
      rec.reset();
      setPhase("answering");
    }
  }

  async function quit() {
    if (!confirm("Leave this interview? It won't be scored.")) return;
    try {
      await apiPost("/api/interview/cancel", { session_id: props.sessionId });
    } catch {
      // Cancelling is a courtesy to the server; never block the exit on it.
    }
    router.push("/dashboard");
  }

  if (phase === "finishing") return <BuildingReport />;

  return (
    // The room is a fixed pane, not a document: it is exactly the viewport and
    // never scrolls as a page. Anything that doesn't fit scrolls inside <main>,
    // so the header and the mic button stay put — a control that slides away
    // mid-answer is worse than a short scroll.
    <div className="flex h-dvh flex-col overflow-hidden bg-room text-room-ink">
      <GrillToaster />
      {/* Unmounting is what releases the camera — see the cleanup in SelfView. */}
      {cameraOn && <SelfView onClose={() => setCameraOn(false)} />}
      {/* Room header: progress, and a way out. */}
      <header className="shrink-0 border-b border-room-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{props.role ?? "Interview"}</p>
            <p className="tabular mt-0.5 font-mono text-xs text-room-muted">
              {Math.min(answered + 1, props.numQuestions)} / {props.numQuestions}
            </p>
          </div>
          <div className="flex flex-1 items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-room-line">
              <div
                className="h-full rounded-full bg-ember transition-[width] duration-500"
                style={{ width: `${(answered / props.numQuestions) * 100}%` }}
              />
            </div>
            <CameraToggle on={cameraOn} onClick={() => setCameraOn((c) => !c)} />
            <button
              onClick={quit}
              disabled={busy}
              className="shrink-0 text-xs text-room-muted underline underline-offset-4 hover:text-room-ink disabled:opacity-50"
            >
              Leave
            </button>
          </div>
        </div>
      </header>

      {/* `min-h-0` is what lets this shrink below its content — without it a
          flex child refuses to shrink and pushes the page tall again, which is
          the scrollbar we're getting rid of. */}
      {/* The vertical rhythm is keyed off viewport HEIGHT, not width: a 1280x720
          laptop is wide but short, and it's the height that decides whether the
          room fits. Short screens get the compact tier; tall ones get the air. */}
      <main className="mx-auto flex w-full min-h-0 max-w-3xl flex-1 flex-col overflow-y-auto px-6 py-4 [@media(min-height:820px)]:py-8">
        {/* `my-auto` rather than `justify-center` on the scroller: centring a
            flex container's overflowing content makes the top unreachable —
            it overflows past the scroll origin. Auto margins centre without
            that, and collapse to zero the moment content fills the pane. */}
        <div className="my-auto w-full">
          <div className="flex items-center justify-between gap-4">
            {/* While the answer is scored, the eyebrow reports what's happening —
              the question below it is stale until the next one arrives. */}
            <span
              className={cx(
                "font-mono text-xs tracking-[0.16em] uppercase",
                busy ? "animate-pulse text-room-muted" : "text-ember",
              )}
            >
              {busy ? "Writing the next question…" : TYPE_LABEL[questionType]}
            </span>
            {!busy && <Interviewer speech={speech} question={question} />}
          </div>

          {/* The question sits under the key-light — the one lit object in the
            room. While sending, it dims and softens: the light is off you until
            the next question turns it back on. */}
          <div
            className={cx(
              "relative mt-3 transition-all duration-500",
              busy && "scale-[0.99] opacity-40 blur-[2px]",
            )}
          >
            <div
              aria-hidden
              className={cx(
                "ember-glow pointer-events-none absolute -top-7 left-1/2 h-[150px] w-[82%] -translate-x-1/2 transition-opacity duration-500",
                busy && "opacity-0",
              )}
            />
            <div className="rounded-card relative border border-line bg-paper-raised p-5 shadow-[0_22px_60px_-32px_rgba(0,0,0,0.85)] [@media(min-height:820px)]:p-6">
              {/* `key` remounts on every new turn, which is what replays the
                stagger — without it React would patch the text in place. */}
              <Question key={turnIndex} text={question} />
            </div>
          </div>

          <div className="mt-6 [@media(min-height:820px)]:mt-8">
            {mode === "voice" ? (
              <VoicePanel
                rec={rec}
                busy={busy}
                onStart={startRecording}
                onStop={finishRecording}
                max={props.maxSeconds}
              />
            ) : (
              <TextPanel
                text={text}
                setText={setText}
                onSubmit={submitText}
                busy={busy}
                disabled={!text.trim()}
              />
            )}

            {(error || rec.error) && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-weak/40 bg-weak/10 px-3 py-2 text-sm text-weak"
              >
                {error || rec.error}
              </p>
            )}

            <div className="mt-6 flex justify-center">
              <button
                onClick={() => {
                  setMode((m) => (m === "voice" ? "text" : "voice"));
                  setError("");
                  rec.reset();
                }}
                disabled={busy || rec.state === "recording"}
                className="text-xs text-room-muted underline underline-offset-4 hover:text-room-ink disabled:opacity-40"
              >
                {mode === "voice" ? "Type it instead" : "Answer out loud instead"}
              </button>
            </div>
          </div>
        </div>
      </main>

      <footer className="shrink-0 pb-6 text-center text-xs text-room-muted">
        {mode === "voice"
          ? "Spoken answers get delivery scoring — pace, pauses, fillers, tone."
          : "Typed answers are scored on content only."}
      </footer>
    </div>
  );
}

/** Stagger between word entrances, and the point past which we stop stacking. */
const WORD_STAGGER_MS = 38;
const WORD_STAGGER_CAP_MS = 900;

/**
 * The question, arriving a word at a time.
 *
 * `aria-label` carries the whole sentence and the words are hidden from the
 * accessibility tree: a screen reader walking a pile of one-word spans reads
 * them as separate items, which turns a question into a list. The delay is
 * capped so a long question doesn't take three seconds to finish landing.
 */
function Question({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    // The step up to 3xl needs both room to wrap and room to breathe: on a short
    // laptop a long question at 3xl runs seven lines and forces the very scroll
    // this layout exists to avoid.
    <h1
      aria-label={text}
      className="font-display text-2xl leading-snug sm:[@media(min-height:820px)]:text-3xl"
    >
      {words.map((word, i) => (
        <span key={i} aria-hidden>
          <span
            className="animate-word inline-block"
            style={{
              animationDelay: `${Math.min(i * WORD_STAGGER_MS, WORD_STAGGER_CAP_MS)}ms`,
            }}
          >
            {word}
          </span>
          {/* A real space between the inline-blocks — without it there's no
              break opportunity and the question stops wrapping. */}
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </h1>
  );
}

function VoicePanel({
  rec,
  busy,
  onStart,
  onStop,
  max,
}: {
  rec: ReturnType<typeof useRecorder>;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  max: number;
}) {
  const recording = rec.state === "recording";
  const remaining = max - rec.seconds;

  if (!rec.supported) {
    return (
      <p className="text-center text-sm text-room-muted">
        This browser can&apos;t record audio. Use the typing option below.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center">
      {/* Live input level — the real mic signal, so a dead mic is obvious. */}
      <div
        className="mb-4 flex h-10 items-end gap-1 [@media(min-height:820px)]:mb-6 [@media(min-height:820px)]:h-12"
        aria-hidden
      >
        {Array.from({ length: 28 }).map((_, i) => {
          // Centre bars react most, so it reads as a voice, not a bar chart.
          const falloff = 1 - Math.abs(i - 13.5) / 15;
          const h = recording ? Math.max(3, rec.level * 46 * falloff) : 3;
          return (
            <span
              key={i}
              className={cx(
                // No height transition while live: the level updates every
                // animation frame, so a 75ms ease never finishes and the bars
                // crawl toward a level that has already moved on. The analyser's
                // own smoothing is what keeps this from looking twitchy.
                "w-1 rounded-full",
                recording ? "bg-ember" : "bg-room-line transition-[height] duration-200",
              )}
              style={{ height: h }}
            />
          );
        })}
      </div>

      {recording ? (
        <>
          <button
            onClick={onStop}
            disabled={busy}
            className="relative flex size-20 items-center justify-center rounded-full bg-ember text-paper transition-transform hover:scale-105 disabled:opacity-50"
            aria-label="Stop recording and submit"
          >
            <span
              aria-hidden
              className="animate-ring absolute -inset-1.5 rounded-full border-2 border-ember"
            />
            <span className="size-6 rounded-sm bg-paper" />
          </button>
          <p className="tabular mt-4 font-mono text-sm">
            <span className="mr-2 inline-block size-2 animate-pulse-rec rounded-full bg-ember align-middle" />
            {fmtTime(rec.seconds)}
            {remaining <= 30 && <span className="ml-2 text-room-muted">{remaining}s left</span>}
          </p>
          <p className="mt-1 text-xs text-room-muted">Tap to finish</p>
        </>
      ) : (
        <>
          <button
            onClick={onStart}
            disabled={busy || rec.state === "requesting"}
            className="flex size-20 items-center justify-center rounded-full border-2 border-ember bg-transparent text-ember transition-colors hover:bg-ember hover:text-paper disabled:opacity-50"
            aria-label="Start recording your answer"
          >
            <MicIcon />
          </button>
          <p className="mt-4 text-sm text-room-muted">
            {busy
              ? "Sending…"
              : rec.state === "requesting"
                ? "Waiting for the mic…"
                : "Tap to answer"}
          </p>
        </>
      )}
    </div>
  );
}

function TextPanel({
  text,
  setText,
  onSubmit,
  busy,
  disabled,
}: {
  text: string;
  setText: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <div>
      <textarea
        autoFocus
        rows={7}
        value={text}
        maxLength={20_000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter alone must insert a newline — people write paragraphs here.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit();
        }}
        placeholder="Talk me through it…"
        className="w-full resize-y rounded-xl border border-room-line bg-room-raised px-4 py-3 text-base leading-relaxed text-room-ink placeholder:text-room-muted focus:border-ember focus:outline-none"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-room-muted">⌘↵ to send</span>
        <button
          onClick={onSubmit}
          disabled={busy || disabled}
          className="rounded-full bg-ember px-6 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-ember-hot disabled:opacity-40"
        >
          {busy ? "Sending…" : "Submit answer"}
        </button>
      </div>
    </div>
  );
}

function BuildingReport() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-room px-6 text-center text-room-ink">
      <span className="size-8 animate-spin rounded-full border-2 border-ember border-t-transparent" />
      <h1 className="mt-6 font-display text-3xl tracking-tight">Reading you back</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-room-muted">
        Scoring every answer and measuring how you sounded. This takes up to a minute — don&apos;t
        close the tab.
      </p>
    </div>
  );
}

function fmtTime(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function MicIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15Z"
        fill="currentColor"
      />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
