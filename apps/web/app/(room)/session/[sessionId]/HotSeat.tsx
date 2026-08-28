"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { AnswerResponse, EndResponse, Persona, QuestionType } from "@repo/types";
import { apiPost, apiPostForm, ApiClientError } from "@/lib/apiClient";
import { personaLabel } from "@/lib/interviewMeta";
import { cx } from "@/components/ui";
import { GrillToaster } from "@/components/toast";
import { useSpeech } from "@/hooks/useSpeech";
import { useLiveTranscript, type LiveTranscript } from "@/hooks/useLiveTranscript";
import { useRecorder } from "./useRecorder";
import { useSessionVideo } from "./useSessionVideo";
import { useCameraMetrics } from "./useCameraMetrics";
import { prefetchQuestionAudio, useInterviewerVoice } from "./useInterviewerVoice";
import { CameraCalibration } from "./CameraCalibration";
import { Interviewer } from "./Interviewer";
import { SelfView, CameraToggle } from "./SelfView";

interface Props {
  sessionId: string;
  name: string | null;
  role: string | null;
  numQuestions: number;
  answered: number;
  turnIndex: number;
  question: string;
  questionType: QuestionType;
  maxSeconds: number;
  maxBytes: number;
  persona: Persona | null;
  videoBitrate: number;
}

type Phase = "answering" | "sending" | "finishing";

const SPEAK_DELAY_MS = 500;

const LEAVE_CANCEL_WAIT_MS = 2_500;

const STALE_CODES = new Set(["turn_already_answered", "unknown_turn", "session_not_active"]);

function isStale(err: unknown): boolean {
  return err instanceof ApiClientError && STALE_CODES.has(err.code);
}

const TYPE_LABEL: Record<QuestionType, string> = {
  technical: "Technical",
  cultural: "Cultural",
  followup: "Follow-up",
  behavioral: "Cultural",
};

const MAX_SEGMENTS = 24;

const SEAT_BANNER = "flex-none border-b border-line bg-paper-raised/60";
const SEAT_BANNER_IN =
  "mx-auto flex max-w-[880px] items-center gap-2.5 px-[18px] py-1.5 font-mono text-[10.5px] tracking-[0.16em] text-ink uppercase sm:gap-3 sm:px-6 sm:py-2";

type SeatTone = "live" | "calm" | "warn";

const SEAT_DOT: Record<SeatTone, string> = {
  live: "bg-ember animate-pulse-rec",
  calm: "bg-mixed",
  warn: "bg-weak",
};

interface SeatLine {
  text: string;
  sub: string;
  tone: SeatTone;
}

function seatLine(s: {
  busy: boolean;
  mode: "voice" | "text";
  rec: ReturnType<typeof useRecorder>;
  speaking: boolean;
}): SeatLine {
  if (s.busy) {
    return { text: "Got it — scoring that answer", sub: "writing the next question", tone: "calm" };
  }
  if (s.mode === "text") {
    return {
      text: "Typing this answer",
      sub: "typed answers are scored on content only",
      tone: "calm",
    };
  }
  if (!s.rec.supported) {
    return {
      text: "This browser can't record audio",
      sub: "type your answer instead",
      tone: "warn",
    };
  }
  switch (s.rec.state) {
    case "denied":
      return {
        text: "Microphone blocked",
        sub: "allow it in your browser, or type this one",
        tone: "warn",
      };
    case "requesting":
      return {
        text: "Waiting for the microphone",
        sub: "allow access when your browser asks",
        tone: "calm",
      };
    case "recording":
      return {
        text: "Listening — speak whenever you're ready",
        sub: "tap the stop button when you've finished the answer",
        tone: "live",
      };
    case "stopped":
      return s.rec.capped
        ? { text: "That's the time limit", sub: "sending what you recorded", tone: "calm" }
        : { text: "That take is in", sub: "sending it now", tone: "calm" };
    default:
      return s.speaking
        ? {
            text: "Reading the question out loud",
            sub: "tap the mic when you're ready",
            tone: "calm",
          }
        : { text: "Ready when you are", sub: "tap the mic, then just talk", tone: "calm" };
  }
}

function SeatState({ line }: { line: SeatLine }) {
  return (
    <div className={SEAT_BANNER} aria-live="polite">
      <div className={SEAT_BANNER_IN}>
        <span
          aria-hidden="true"
          className={cx("size-2 flex-none rounded-full", SEAT_DOT[line.tone])}
        />
        <span className="min-w-0 truncate">{line.text}</span>
        <em className="truncate not-italic tracking-[0.1em] text-ink-muted max-sm:hidden">
          · {line.sub}
        </em>
      </div>
    </div>
  );
}

export function HotSeat(props: Props) {
  const router = useRouter();
  const rec = useRecorder(props.maxSeconds);
  const speech = useSpeech();
  const video = useSessionVideo(props.sessionId, props.videoBitrate);
  const camera = useCameraMetrics(video.stream);
  const live = useLiveTranscript(rec.state === "recording");

  const [turnIndex, setTurnIndex] = useState(props.turnIndex);
  const [question, setQuestion] = useState(props.question);
  const [questionType, setQuestionType] = useState<QuestionType>(props.questionType);
  const [answered, setAnswered] = useState(props.answered);

  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("answering");
  const [error, setError] = useState("");
  const [pipOpen, setPipOpen] = useState(true);
  const [calibrationDone, setCalibrationDone] = useState(false);
  const onCalibrated = useCallback(() => setCalibrationDone(true), []);

  const busy = phase !== "answering";

  const turnShownAt = useRef(performance.now());
  useEffect(() => {
    turnShownAt.current = performance.now();
  }, [turnIndex]);

  const finishVideo = useRef<Promise<void> | null>(null);

  const videoFields = () => {
    const offset = video.offsetAt(turnShownAt.current);
    return video.videoId && offset !== null
      ? { video_id: video.videoId, video_offset_ms: offset }
      : {};
  };

  const voice = useInterviewerVoice({
    sessionId: props.sessionId,
    turnIndex,
    question,
    speech,
    delayMs: SPEAK_DELAY_MS,
  });
  const stopSpeaking = voice.stop;

  useEffect(() => {
    if (speech.muted) stopSpeaking();
  }, [speech.muted, stopSpeaking]);

  function startRecording() {
    stopSpeaking();
    rec.start();
    camera.beginTake();
  }

  const textTakeTurn = useRef<number | null>(null);
  const beginTextTake = () => {
    if (textTakeTurn.current === turnIndex) return;
    textTakeTurn.current = turnIndex;
    camera.beginTake();
  };

  async function afterAnswer(res: AnswerResponse) {
    setAnswered((n) => n + 1);
    if (!res.done && res.next_question) {
      setTurnIndex(res.turn_index + 1);
      setQuestion(res.next_question);
      setQuestionType(res.next_question_type ?? "technical");
      prefetchQuestionAudio(props.sessionId, res.turn_index + 1);
      setText("");
      rec.reset();
      setPhase("answering");
      return;
    }
    stopSpeaking();
    rec.reset();
    setPhase("finishing");
    finishVideo.current = video.finish();
    try {
      await apiPost<EndResponse>("/api/interview/end", {
        session_id: props.sessionId,
      });
    } catch {}
  }

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

  function resync(): void {
    setError("");
    rec.reset();
    setPhase("answering");
    router.refresh();
  }

  async function submitText() {
    if (!text.trim() || busy) return;
    const cam = camera.endTake();
    stopSpeaking();
    setPhase("sending");
    setError("");
    const send = async () => {
      const res = await apiPost<AnswerResponse>("/api/interview/answer-text", {
        session_id: props.sessionId,
        turn_index: turnIndex,
        text: text.trim(),
        ...videoFields(),
        ...(cam ? { camera_metrics: cam } : {}),
      });
      await afterAnswer(res);
    };
    try {
      await track(send(), "Couldn't send that answer.");
    } catch (err) {
      if (isStale(err)) return resync();
      camera.beginTake();
      setError(err instanceof ApiClientError ? err.message : "Couldn't send that answer.");
      setPhase("answering");
    }
  }

  const capSubmit = useRef(finishRecording);
  capSubmit.current = finishRecording;
  useEffect(() => {
    if (rec.capped && phase === "answering") void capSubmit.current();
  }, [rec.capped, phase]);

  async function finishRecording() {
    const blob = await rec.stop();
    const cam = camera.endTake();
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
      if (cam) form.append("camera_metrics", JSON.stringify(cam));
      for (const [k, v] of Object.entries(videoFields())) form.append(k, String(v));
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
    stopSpeaking();
    rec.reset();
    video.stream?.getTracks().forEach((t) => t.stop());
    await Promise.race([
      apiPost("/api/interview/cancel", { session_id: props.sessionId }).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, LEAVE_CANCEL_WAIT_MS)),
    ]);
    router.push("/dashboard");
  }

  if (phase === "finishing") {
    return <ThankYou sessionId={props.sessionId} saving={finishVideo.current} />;
  }

  const currentQ = Math.min(answered + 1, props.numQuestions);

  return (
    <div className="room-root">
      <div className="grain" aria-hidden="true" />
      <GrillToaster />

      <header className="room-top">
        <div className="room-top-in">
          <div className="room-id">
            <p className="room-name">{props.name?.trim() || props.role?.trim() || "Interview"}</p>
            <p className="room-meta">
              <b>Q{currentQ}</b> / {props.numQuestions}
              {props.name && props.role ? ` · ${props.role}` : ""}
            </p>
          </div>

          <Progress answered={answered} total={props.numQuestions} />

          <div className="room-ctl">
            <span className="border border-line px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] whitespace-nowrap uppercase text-ink-muted max-sm:hidden">
              {personaLabel(props.persona)}
            </span>
            <RecDot state={video.state} />
            {video.stream && <CameraToggle on={pipOpen} onClick={() => setPipOpen((c) => !c)} />}
            <button onClick={quit} disabled={busy} className="underlink">
              Leave
            </button>
          </div>
        </div>
      </header>

      <SeatState line={seatLine({ busy, mode, rec, speaking: voice.speaking })} />

      <main className="room-main">
        <div className="room-in">
          <div className="room-center">
            <div className="q-head">
              <span className="q-type" data-kind={questionType}>
                {TYPE_LABEL[questionType]}
              </span>
              {!busy && (
                <Interviewer
                  speech={speech}
                  question={question}
                  micLive={rec.state === "recording" || rec.state === "requesting"}
                  speaking={voice.speaking}
                  replay={voice.replay}
                />
              )}
            </div>

            {questionType === "followup" && (
              <p className="mt-3 inline-flex items-center gap-2 border border-mixed/35 px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] text-mixed uppercase">
                <span aria-hidden="true">↺</span>
                This one came from what you just said
              </p>
            )}

            <div className="q-wrap" data-busy={busy}>
              <div aria-hidden="true" className="q-light ember-glow" />
              <div className="q-card">
                <span className="q-n" aria-hidden="true">
                  {String(currentQ).padStart(2, "0")}
                </span>
                <Question key={turnIndex} text={question} />
              </div>
            </div>

            <div className="mic-zone">
              {mode === "voice" ? (
                <VoicePanel
                  rec={rec}
                  busy={busy}
                  onStart={startRecording}
                  onStop={finishRecording}
                  max={props.maxSeconds}
                  runningLong={
                    (questionType === "cultural" || questionType === "behavioral") &&
                    rec.seconds > 0.6 * props.maxSeconds
                  }
                />
              ) : (
                <TextPanel
                  text={text}
                  setText={setText}
                  onSubmit={submitText}
                  onFocus={beginTextTake}
                  busy={busy}
                  disabled={!text.trim()}
                />
              )}

              {(error || rec.error) && (
                <p className="error-note room-error" role="alert" key={error || rec.error}>
                  {error || rec.error}
                </p>
              )}

              <div className="mode-swap">
                <button
                  onClick={() => {
                    setMode((m) => (m === "voice" ? "text" : "voice"));
                    setError("");
                    rec.reset();
                  }}
                  disabled={busy || rec.state === "recording"}
                  className="underlink"
                >
                  {mode === "voice" ? "Type this one instead" : "Go back to speaking"}
                </button>
              </div>
            </div>

            {pipOpen && video.stream && (
              <p className="mt-6 max-w-[62ch] font-mono text-[10px] leading-[1.9] tracking-[0.14em] text-ink-muted uppercase">
                Your camera floats free —{" "}
                <b className="font-medium text-ink-soft">drag the bar to move it</b>, drag its
                corner to resize, or use <Key>S</Key>
                <Key>M</Key>
                <Key>L</Key>. Double-click the bar to snap it to a corner.
              </p>
            )}

            {mode === "voice" && rec.supported && (
              <LiveDelivery rec={rec} max={props.maxSeconds} live={live} />
            )}
          </div>
        </div>
      </main>

      <footer className="room-foot">
        <p>
          {mode === "voice"
            ? "Spoken answers get delivery scoring — pace, pauses, fillers, tone."
            : "Typed answers are scored on content only."}
        </p>
        {video.state === "denied" || video.state === "failed" ? null : (
          <p>
            This interview is being recorded — picture and sound, for the whole session — so you can
            watch it back. Deleted after 100 days.
          </p>
        )}
        {camera.state === "ready" ? (
          <p>On-camera analysis runs on this device. Nothing is uploaded but the numbers.</p>
        ) : null}
      </footer>

      {pipOpen && video.stream && (
        <SelfView
          stream={video.stream}
          onClose={() => setPipOpen(false)}
          micOn={rec.state === "recording"}
          level={rec.level}
          recording={video.state === "recording"}
        />
      )}

      {video.state === "recording" && camera.state === "ready" && !calibrationDone ? (
        <CameraCalibration
          sessionId={props.sessionId}
          calibrate={camera.calibrate}
          onDone={onCalibrated}
        />
      ) : null}
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 border border-line px-1 py-px font-mono text-[9.5px] text-ink-soft">
      {children}
    </kbd>
  );
}

function LiveDelivery({
  rec,
  max,
  live,
}: {
  rec: ReturnType<typeof useRecorder>;
  max: number;
  live: LiveTranscript;
}) {
  const recording = rec.state === "recording";
  const dash = "—";
  return (
    <details className="group mt-9 max-w-[560px] border-t border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3.5 font-mono text-[10.5px] tracking-[0.16em] text-ink-muted uppercase transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        Show how I&apos;m sounding right now
        <span
          aria-hidden="true"
          className="grid size-5 flex-none place-items-center border border-line text-[12px] leading-none text-ink-soft group-open:border-ember/40 group-open:text-ember"
        >
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:block">–</span>
        </span>
      </summary>
      <div className="pb-6">
        <p className="mb-4 border border-dashed border-mixed/35 px-3 py-2.5 font-mono text-[10px] leading-relaxed tracking-[0.12em] text-mixed uppercase">
          Heads up — watching these while you talk usually makes people worse, not better.
          They&apos;re all in the report afterwards.
        </p>
        <div className="border border-line">
          <div className="grid grid-cols-3">
            <Metric
              k="Input level"
              v={recording ? String(Math.round(rec.level * 100)) : dash}
              unit="%"
            />
            <Metric k="This answer" v={recording ? fmtTime(rec.seconds) : dash} />
            <Metric k="Time left" v={recording ? fmtTime(Math.max(0, max - rec.seconds)) : dash} />
          </div>
          {live.supported && (
            <div className="grid grid-cols-3 border-t border-line">
              <Metric
                k="Pace (rolling)"
                v={recording && live.rollingWpm !== null ? String(live.rollingWpm) : dash}
                unit="wpm"
              />
              <Metric k="Fillers so far" v={recording ? String(live.fillers) : dash} />
              <Metric k="Words" v={recording ? String(live.words) : dash} />
            </div>
          )}
        </div>
        {live.supported && (
          <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-[0.12em] text-ink-muted uppercase">
            Live numbers come from your browser&apos;s speech engine and are never sent to Grill.
            The report uses the recording.
          </p>
        )}
      </div>
    </details>
  );
}

function Metric({ k, v, unit }: { k: string; v: string; unit?: string }) {
  return (
    <div className="border-l border-line px-4 py-3.5 first:border-l-0">
      <span className="font-mono text-[9.5px] tracking-[0.16em] text-ink-muted uppercase">{k}</span>
      <p className="mt-1 font-mono text-[18px] font-semibold tabular-nums">
        {v}
        {unit && v !== "—" && (
          <i className="ml-0.5 text-[9.5px] not-italic text-ink-muted">{unit}</i>
        )}
      </p>
    </div>
  );
}

function Progress({ answered, total }: { answered: number; total: number }) {
  if (total > MAX_SEGMENTS) {
    return (
      <div className="rprog" aria-hidden="true">
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${(answered / total) * 100}%` }} />
        </div>
      </div>
    );
  }
  return (
    <div className="rprog" aria-hidden="true">
      <div className="segs">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className="seg-i" data-done={i < answered} data-live={i === answered} />
        ))}
      </div>
    </div>
  );
}

function RecDot({ state }: { state: ReturnType<typeof useSessionVideo>["state"] }) {
  if (state === "starting") {
    return <span className="rec-chip">CAM…</span>;
  }
  if (state === "denied" || state === "failed") {
    return (
      <span
        className="rec-chip"
        title={
          state === "denied"
            ? "Camera blocked — the interview still works, but the replay will have no video."
            : "Camera unavailable — the interview still works, but the replay will have no video."
        }
      >
        NO CAM
      </span>
    );
  }
  if (state !== "recording") return null;
  return (
    <span className="rec-chip" title="This interview is being recorded">
      <span aria-hidden="true" className="rec-dot animate-pulse-rec" />
      REC
    </span>
  );
}

const WORD_STAGGER_MS = 38;
const WORD_STAGGER_CAP_MS = 900;

function Question({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <h1 aria-label={text} className="q-text">
      {words.map((word, i) => (
        <span key={i} aria-hidden>
          <span
            className="animate-word inline-block"
            style={{
              display: "inline-block",
              animationDelay: `${Math.min(i * WORD_STAGGER_MS, WORD_STAGGER_CAP_MS)}ms`,
            }}
          >
            {word}
          </span>
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
  runningLong,
}: {
  rec: ReturnType<typeof useRecorder>;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  max: number;
  runningLong: boolean;
}) {
  const recording = rec.state === "recording";
  const remaining = max - rec.seconds;

  if (!rec.supported) {
    return (
      <p className="mic-unsupported">
        This browser can&apos;t record audio. Use the typing option below.
      </p>
    );
  }

  return (
    <div className="mic-col">
      <div className="lvl" aria-hidden="true">
        {Array.from({ length: 28 }).map((_, i) => {
          const falloff = 1 - Math.abs(i - 13.5) / 15;
          const h = recording ? Math.max(3, rec.level * 46 * falloff) : 3;
          return (
            <span
              key={i}
              className="lvl-bar"
              data-hot={recording}
              style={{ height: h, background: recording ? "var(--color-strong)" : undefined }}
            />
          );
        })}
      </div>

      {recording ? (
        <>
          <button
            onClick={onStop}
            disabled={busy}
            className="stop-btn"
            aria-label="Stop recording and submit"
          >
            <span aria-hidden="true" className="stop-ring animate-ring" />
            <span className="stop-sq" />
          </button>
          <p className="take-time">
            <span className="take-dot animate-pulse-rec" aria-hidden="true" />
            {fmtTime(rec.seconds)}
            {remaining <= 30 && <span className="take-left">{remaining}s left</span>}
          </p>
          <p className="mic-note">Tap to finish</p>
          {runningLong && (
            <p className="mt-2 font-mono text-[10px] tracking-[0.14em] text-mixed uppercase">
              Running long for a behavioral answer — land the result.
            </p>
          )}
        </>
      ) : (
        <>
          <button
            onClick={onStart}
            disabled={busy || rec.state === "requesting"}
            className="mic-btn"
            aria-label="Start recording your answer"
          >
            <MicIcon />
          </button>
          <p className="mic-note">Tap to answer</p>
        </>
      )}
    </div>
  );
}

function TextPanel({
  text,
  setText,
  onSubmit,
  onFocus,
  busy,
  disabled,
}: {
  text: string;
  setText: (v: string) => void;
  onSubmit: () => void;
  onFocus: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <div>
      <label
        htmlFor="typed-answer"
        className="mb-2 block font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase"
      >
        Typed answer — this one won&apos;t be scored on delivery
      </label>
      <textarea
        id="typed-answer"
        autoFocus
        rows={7}
        value={text}
        maxLength={20_000}
        onFocus={onFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit();
        }}
        placeholder="Talk me through it…"
        className="input area"
      />
      <div className="send-row">
        <span className="kbd-note">⌘↵ to send</span>
        <button onClick={onSubmit} disabled={busy || disabled} className="btn btn-primary btn-sm">
          {busy ? "Sending…" : "Submit answer"}
        </button>
      </div>
    </div>
  );
}

const REDIRECT_MS = 5_000;

const MARK_C = 2 * Math.PI * 30;

function DoneMark() {
  return (
    <svg
      className="done-mark"
      viewBox="0 0 72 72"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="36" cy="36" r="30" className="dmark-disc" />
      <circle
        cx="36"
        cy="36"
        r="30"
        className="dmark-arc"
        style={{ "--c": MARK_C } as React.CSSProperties}
        transform="rotate(-90 36 36)"
      />
      <path className="dmark-check" d="M24.5 37.5 L32.5 45 L48 28.5" pathLength={100} />
    </svg>
  );
}

function ThankYou({ sessionId, saving }: { sessionId: string; saving: Promise<void> | null }) {
  const router = useRouter();
  const [flushing, setFlushing] = useState(Boolean(saving));

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const leave = () => {
      if (!cancelled) timer = setTimeout(() => router.push("/dashboard"), REDIRECT_MS);
    };
    if (!saving) {
      setFlushing(false);
      leave();
    } else {
      void saving.then(() => {
        if (cancelled) return;
        setFlushing(false);
        leave();
      });
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [saving, router]);

  return (
    <div className="done">
      <div className="grain" aria-hidden="true" />
      <div className="done-glow" aria-hidden="true" />
      <div className="done-in animate-rise">
        <DoneMark />
        <h1 className="done-h">That&apos;s the interview.</h1>
        <p className="done-sub">
          {flushing
            ? "Saving the last of your recording — this only takes a moment."
            : "You can close this — we're scoring every answer and measuring how you sounded. Your report will be waiting on the dashboard."}
        </p>
        <div className="done-btns">
          <button onClick={() => router.push(`/report/${sessionId}`)} className="btn btn-primary">
            Wait for the report
          </button>
          <button onClick={() => router.push("/dashboard")} className="underlink">
            Go to the dashboard now
          </button>
        </div>
      </div>
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
