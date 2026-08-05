"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { AnswerResponse, EndResponse, QuestionType } from "@repo/types";
import { apiPost, apiPostForm, ApiClientError } from "@/lib/apiClient";
import { cx } from "@/components/ui";
import { GrillToaster } from "@/components/toast";
import { useSpeech } from "@/hooks/useSpeech";
import { useRecorder } from "./useRecorder";
import { useSessionVideo } from "./useSessionVideo";
import { Interviewer } from "./Interviewer";
import { SelfView, CameraToggle } from "./SelfView";

interface Props {
  sessionId: string;
  /** Null only for sessions created before interviews were named. */
  name: string | null;
  role: string | null;
  numQuestions: number;
  answered: number;
  turnIndex: number;
  question: string;
  questionType: QuestionType;
  maxSeconds: number;
  maxBytes: number;
  /**
   * Threaded from the server page rather than imported: the config lives in
   * lib/env.ts, which is `server-only`, and importing it from a client component
   * pulls server secrets into the browser bundle.
   */
  videoBitrate: number;
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

/**
 * Past this, the per-question cells drop below legibility and the progress
 * strip degrades to a plain bar — an interview can run up to 100 questions.
 */
const MAX_SEGMENTS = 24;

/**
 * The state banner.
 *
 * The room is a dark screen with a question on it, and nothing on it says which
 * of several very different things is happening: the interviewer is still
 * reading the question, the mic is waiting on a permission prompt, the recorder
 * is live, or the answer is off being scored. Silence reads as "broken" — people
 * stop mid-answer to check. One line, above the question, in words.
 *
 * It lives outside `.room-main`, so it costs the scrolling area ~28px once and
 * never moves. Deliberately one line: the mic button has to stay above the fold
 * on a 640px-tall laptop.
 */
const SEAT_BANNER = "flex-none border-b border-line bg-paper-raised/60";
const SEAT_BANNER_IN =
  "mx-auto flex max-w-[880px] items-center gap-2.5 px-[18px] py-1.5 font-mono text-[10.5px] tracking-[0.16em] text-ink uppercase sm:gap-3 sm:px-6 sm:py-2";

type SeatTone = "live" | "calm" | "warn";

/** Ember is reserved for "actually recording"; nothing else may borrow it. */
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

/**
 * What the room is doing right now, in the order that outranks.
 *
 * Every branch has to be true for the state it renders in — a banner reading
 * "Listening" while the recorder is idle tells the candidate their answer is
 * being captured when nothing is being captured at all, which is the one lie
 * this must never tell. So the pre-tap state says it is waiting for the tap,
 * and only `state === "recording"` gets to say "listening".
 */
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
    return { text: "Typing this answer", sub: "typed answers are scored on content only", tone: "calm" };
  }
  if (!s.rec.supported) {
    return { text: "This browser can't record audio", sub: "type your answer instead", tone: "warn" };
  }
  switch (s.rec.state) {
    case "denied":
      return { text: "Microphone blocked", sub: "allow it in your browser, or type this one", tone: "warn" };
    case "requesting":
      return { text: "Waiting for the microphone", sub: "allow access when your browser asks", tone: "calm" };
    case "recording":
      return {
        text: "Listening — speak whenever you're ready",
        sub: "tap the stop button when you've finished the answer",
        tone: "live",
      };
    case "stopped":
      // Only the cap sets `capped`, and the cap is a full answer, not a lost
      // one — say which of the two just happened.
      return s.rec.capped
        ? { text: "That's the time limit", sub: "sending what you recorded", tone: "calm" }
        : { text: "That take is in", sub: "sending it now", tone: "calm" };
    default:
      return s.speaking
        ? { text: "Reading the question out loud", sub: "the mic starts when you tap", tone: "calm" }
        : { text: "Ready when you are", sub: "tap the mic, then just talk", tone: "calm" };
  }
}

function SeatState({ line }: { line: SeatLine }) {
  return (
    // Polite, never assertive: this narrates state, and it must not cut across
    // a screen reader that is still reading the question out.
    <div className={SEAT_BANNER} aria-live="polite">
      <div className={SEAT_BANNER_IN}>
        <span aria-hidden="true" className={cx("size-2 flex-none rounded-full", SEAT_DOT[line.tone])} />
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
  // Always recording — no switch. The camera prompt is still the browser's to
  // ask, and a denial just means the replay has no picture.
  const video = useSessionVideo(props.sessionId, props.videoBitrate);

  const [turnIndex, setTurnIndex] = useState(props.turnIndex);
  const [question, setQuestion] = useState(props.question);
  const [questionType, setQuestionType] = useState<QuestionType>(props.questionType);
  const [answered, setAnswered] = useState(props.answered);

  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("answering");
  const [error, setError] = useState("");
  // Whether the picture-in-picture is on SCREEN — not whether the camera is on.
  // Recording is unconditional; this only hides the preview.
  const [pipOpen, setPipOpen] = useState(true);

  const busy = phase !== "answering";

  /**
   * When this question appeared, on the same monotonic clock the recording uses.
   * Captured here rather than at submit time because the replay should open on
   * the question being asked, not on the answer already finishing.
   */
  const turnShownAt = useRef(performance.now());
  useEffect(() => {
    turnShownAt.current = performance.now();
  }, [turnIndex]);

  /** The tail flush, handed to ThankYou so it can wait for it before leaving. */
  const finishVideo = useRef<Promise<void> | null>(null);

  /** The video fields to stamp on this answer, or nothing if there's no camera. */
  const videoFields = () => {
    const offset = video.offsetAt(turnShownAt.current);
    return video.videoId && offset !== null
      ? { video_id: video.videoId, video_offset_ms: offset }
      : {};
  };

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
    // Last answer in. /end only queues the report now and returns at once, so
    // this is a fast call — the build happens behind the thank-you screen.
    setPhase("finishing");
    // Fire the flush now, but do NOT await it here: ThankYou waits on it before
    // starting its countdown. Awaiting here would leave the candidate staring at
    // a frozen room while the tail uploads.
    finishVideo.current = video.finish();
    try {
      await apiPost<EndResponse>("/api/interview/end", {
        session_id: props.sessionId,
      });
    } catch {
      // Swallowed deliberately. `processAnswer` already queued this session
      // before it told us `done`, so the report is safe whatever happens here —
      // /end only makes it faster. Nothing the candidate could do with the error
      // anyway, and the report page reports the real state when they open it.
    }
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
        ...videoFields(),
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

  /**
   * Submit the take the cap ended, because nothing else will.
   *
   * `useRecorder` stops itself at the ceiling, which flips its state out of
   * "recording" — and the stop button is rendered on exactly that state, so the
   * one control that submits an answer disappears at the instant the answer
   * becomes complete. The candidate is left looking at a mic button that starts
   * a new take over the finished one. Reaching the limit is a full answer, not a
   * discarded one, so send it.
   *
   * `capped` is what makes this safe to key on: plain "stopped" is also what a
   * manual submit looks like while `finishRecording` is awaiting the blob, and
   * this would fire underneath it. Only the cap sets `capped`, and `start`/
   * `reset` clear it, so it fires once per capped take.
   */
  const capSubmit = useRef(finishRecording);
  capSubmit.current = finishRecording;
  useEffect(() => {
    if (rec.capped && phase === "answering") void capSubmit.current();
  }, [rec.capped, phase]);

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
    try {
      await apiPost("/api/interview/cancel", { session_id: props.sessionId });
    } catch {
      // Cancelling is a courtesy to the server; never block the exit on it.
    }
    router.push("/dashboard");
  }

  if (phase === "finishing") {
    return <ThankYou sessionId={props.sessionId} saving={finishVideo.current} />;
  }

  const currentQ = Math.min(answered + 1, props.numQuestions);

  return (
    // The room is a fixed pane, not a document: it is exactly the viewport and
    // never scrolls as a page. Anything that doesn't fit scrolls inside
    // `.room-main`, so the header and the mic button stay put — a control that
    // slides away mid-answer is worse than a short scroll.
    <div className="room-root">
      <div className="grain" aria-hidden="true" />
      <GrillToaster />

      {/* Room chrome: what this is, how far in you are, and a way out. */}
      <header className="room-top">
        <div className="room-top-in">
          <div className="room-id">
            {/* The name the candidate gave this interview, with the role
                demoted to the meta line — the role is what the questions aim
                at, but the name is what they called it. */}
            <p className="room-name">{props.name?.trim() || props.role?.trim() || "Interview"}</p>
            <p className="room-meta">
              <b>Q{currentQ}</b> / {props.numQuestions}
              {props.name && props.role ? ` · ${props.role}` : ""}
            </p>
          </div>

          <Progress answered={answered} total={props.numQuestions} />

          <div className="room-ctl">
            <RecDot state={video.state} />
            {video.stream && <CameraToggle on={pipOpen} onClick={() => setPipOpen((c) => !c)} />}
            <button onClick={quit} disabled={busy} className="underlink">
              Leave
            </button>
          </div>
        </div>
      </header>

      <SeatState line={seatLine({ busy, mode, rec, speaking: speech.speaking })} />

      <main className="room-main">
        <div className="room-in">
          {/* Auto margins centre the block without making the top unreachable
              when a long question overflows a short viewport. */}
          <div className="room-center">
            <div className="q-head">
              {/* The eyebrow used to swap to "Writing the next question…" while
                  busy. The banner above now says exactly that, in the same
                  words, forty pixels higher — two lines saying one thing. The
                  banner keeps it (it is on screen in every state, so it never
                  jumps), and the eyebrow goes back to only ever naming the kind
                  of question, which stays true while the stale one is dimmed. */}
              <span className="q-type" data-kind={questionType}>
                {TYPE_LABEL[questionType]}
              </span>
              {!busy && <Interviewer speech={speech} question={question} />}
            </div>

            {/* A follow-up is the one question type whose PROVENANCE matters:
                it exists because of the answer just given, and people who don't
                know that read it as the interviewer repeating itself. Amber,
                not ember — ember means "recording" in this room and nothing
                else may borrow it. */}
            {questionType === "followup" && (
              <p className="mt-3 inline-flex items-center gap-2 border border-mixed/35 px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] text-mixed uppercase">
                <span aria-hidden="true">↺</span>
                This one came from what you just said
              </p>
            )}

            {/* The question sits under the key-light — the one lit object in
                the room. While sending, it dims and softens: the light is off
                you until the next question turns it back on. */}
            <div className="q-wrap" data-busy={busy}>
              <div aria-hidden="true" className="q-light ember-glow" />
              <div className="q-card">
                {/* The turn number, seared into the card behind the words. */}
                <span className="q-n" aria-hidden="true">
                  {String(currentQ).padStart(2, "0")}
                </span>
                {/* `key` remounts on every new turn, which is what replays the
                    stagger — without it React would patch the text in place. */}
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

            {/* The self view can be dragged, resized and snapped, and every one
                of those affordances is invisible until you happen to grab the
                right pixel — SelfView's own comment says corner-dragging is
                undiscoverable, which is why the S/M/L presets exist at all.
                Only worth the lines while the box is actually on screen. */}
            {pipOpen && video.stream && (
              <p className="mt-6 max-w-[62ch] font-mono text-[10px] leading-[1.9] tracking-[0.14em] text-ink-muted uppercase">
                Your camera floats free — <b className="font-medium text-ink-soft">drag the bar
                to move it</b>, drag its corner to resize, or use <Key>S</Key>
                <Key>M</Key>
                <Key>L</Key>. Double-click the bar to snap it to a corner.
              </p>
            )}

            {mode === "voice" && rec.supported && <LiveDelivery rec={rec} max={props.maxSeconds} />}
          </div>
        </div>
      </main>

      {/* Recording is always on and there is no way to turn it off, so saying
          so is the minimum this screen owes the candidate. The REC dot in the
          header says it's happening; this says what happens to it. */}
      <footer className="room-foot">
        <p>
          {mode === "voice"
            ? "Spoken answers get delivery scoring — pace, pauses, fillers, tone."
            : "Typed answers are scored on content only."}
        </p>
        {video.state === "recording" ? (
          <p>This interview is being recorded so you can watch it back. Deleted after 100 days.</p>
        ) : null}
      </footer>

      {/* Purely a preview. Unmounting it no longer touches the camera — the
          stream belongs to useSessionVideo, and the recording outlives this.

          Mounted LAST on purpose. It is `fixed z-50`, so DOM order costs it
          nothing visually, and it carries six tab stops of its own (the group,
          S/M/L, minimise, close). In front of the room that put all six between
          the candidate and the button that submits their answer. */}
      {pipOpen && video.stream && (
        <SelfView
          stream={video.stream}
          onClose={() => setPipOpen(false)}
          // The mic belongs to `useRecorder`, not to the camera stream — the
          // self view has no way to know whether anything is being heard, so
          // the level is handed down rather than measured there.
          micOn={rec.state === "recording"}
          level={rec.level}
          recording={video.state === "recording"}
        />
      )}
    </div>
  );
}

/** A keycap, for the camera hint. Square, like every other border in the room. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 border border-line px-1 py-px font-mono text-[9.5px] text-ink-soft">
      {children}
    </kbd>
  );
}

/**
 * Live delivery numbers — shut by default, and that is the whole point.
 *
 * Watching your own pace and volume while you talk makes people perform the
 * meter instead of answering the question, which is the same failure mode that
 * took the live transcript off this screen. The full delivery breakdown is in
 * the report, measured from the audio, and it is better there. This exists only
 * so that someone who suspects the mic is dead can check a number rather than
 * trust a bar.
 *
 * Only what is genuinely measured client-side is in here: pace, fillers and
 * tone all need the transcript, which is produced server-side after the take is
 * sent, so quoting them live would mean inventing them.
 */
function LiveDelivery({ rec, max }: { rec: ReturnType<typeof useRecorder>; max: number }) {
  const recording = rec.state === "recording";
  const dash = "—";
  return (
    <details className="group mt-9 max-w-[560px] border-t border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3.5 font-mono text-[10.5px] tracking-[0.16em] text-ink-muted uppercase transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        Show how I&apos;m sounding right now
        {/* Two glyphs toggled by the `open` state rather than one `::after`
            with generated content: the disclosure sign is the only thing
            saying which way this drawer moves, and utility-generated content
            is one Tailwind-scanner quirk away from rendering as nothing. */}
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
        <div className="grid grid-cols-3 border border-line">
          <Metric k="Input level" v={recording ? String(Math.round(rec.level * 100)) : dash} unit="%" />
          <Metric k="This answer" v={recording ? fmtTime(rec.seconds) : dash} />
          <Metric k="Time left" v={recording ? fmtTime(Math.max(0, max - rec.seconds)) : dash} />
        </div>
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
        {unit && v !== "—" && <i className="ml-0.5 text-[9.5px] not-italic text-ink-muted">{unit}</i>}
      </p>
    </div>
  );
}

/**
 * Progress as a burner strip: one cell per question, lighting left to right,
 * the current one warming. Past MAX_SEGMENTS the cells drop below legibility
 * (an interview can run to 100 questions), so it degrades to a plain bar.
 */
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

/**
 * The recording indicator.
 *
 * There is no opt-out, so this is the only thing telling the candidate the
 * camera is running — which makes it the honest minimum, not decoration. It also
 * doubles as the answer to "is it actually working?", which is why a denied
 * camera says so plainly rather than showing nothing.
 */
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
      <p className="mic-unsupported">
        This browser can&apos;t record audio. Use the typing option below.
      </p>
    );
  }

  return (
    <div className="mic-col">
      {/*
       * Live input level — the real mic signal, so a dead mic is obvious.
       *
       * Green, never ember. This screen deliberately shows you nothing of what
       * you are saying (see LiveDelivery), so the meter is the ONLY proof left
       * that you are being heard — which makes it worth reading at a glance and
       * worth not confusing with anything else. Ember means "this is being
       * recorded" in every other part of the room (the REC chip, the take dot,
       * the stop button); a red meter beside them reads as a second recording
       * light rather than as "the mic can hear you".
       *
       * Painted inline rather than by class because `.lvl-bar[data-hot]` in
       * globals.css carries an ember gradient, and that file is not this
       * component's to change.
       */}
      <div className="lvl" aria-hidden="true">
        {Array.from({ length: 28 }).map((_, i) => {
          // Centre bars react most, so it reads as a voice, not a bar chart.
          const falloff = 1 - Math.abs(i - 13.5) / 15;
          const h = recording ? Math.max(3, rec.level * 46 * falloff) : 3;
          return (
            // No height transition while live: the level updates every frame,
            // so an ease never finishes and the bars crawl toward a level that
            // has already moved on. The analyser's smoothing does the work.
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
          {/* This used to swap to "Sending…" and "Waiting for the mic…". The
              banner says both of those already, in the same words and in the
              same states — so this goes back to only ever naming what the
              button does, which stays true while it sits there disabled. */}
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
      {/* Says what the trade is BEFORE the answer is written, not after: a
          typed answer is scored on content alone, and finding that out from
          the report is finding it out too late. */}
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
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter alone must insert a newline — people write paragraphs here.
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

/** How long the thank-you screen holds before it sends them to the dashboard. */
const REDIRECT_MS = 5_000;

/** r=30 circle. The arc sweep and the check draw are both dash tricks on it. */
const MARK_C = 2 * Math.PI * 30;

/**
 * The completion seal — the same ember-ringed disc as the profile page's
 * initials seal, holding a drawn check instead of a monogram.
 *
 * Static geometry, animated only by CSS dash offsets: the arc sweeps around the
 * ring and the check draws itself a beat later (`g-sweep` / `g-draw`). Nothing
 * random and nothing computed per-render, so server and client HTML match.
 */
function DoneMark() {
  return (
    <svg
      className="done-mark"
      viewBox="0 0 72 72"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* The disc — ember-soft fill on a resting hairline. */}
      <circle cx="36" cy="36" r="30" className="dmark-disc" />
      {/* The sweep: one ember lap, ending as the check begins. */}
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

/**
 * The end of the interview.
 *
 * The report is built behind this screen now, not in front of it, so this says
 * the interview is over and lets them leave rather than holding them hostage to
 * a spinner. Five seconds, then the dashboard — where the session shows as
 * scoring, and turns into a report when it's ready.
 *
 * The screen this replaced told them not to close the tab. That instruction is
 * now a lie worth deleting: the session was queued server-side before the client
 * was ever told the interview was over, so closing the tab costs nothing.
 */
function ThankYou({ sessionId, saving }: { sessionId: string; saving: Promise<void> | null }) {
  const router = useRouter();
  const [flushing, setFlushing] = useState(Boolean(saving));

  /**
   * The countdown starts only once the recording's tail is in R2.
   *
   * These two requirements fight: the last part of the video can only upload
   * after the final answer, and it used to have a 30-120s synchronous report
   * build to hide behind. Against a 5s redirect it would lose — a buffered tail
   * on a slow uplink takes longer than that, and navigating away kills the
   * in-flight PUTs. So the five seconds are counted from when the upload lands,
   * not from when the screen appears. In the normal case the flush is already
   * done and this is indistinguishable from a plain 5s wait.
   */
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
      // Never rejects — finish() swallows its own errors, leaving the parts in
      // R2 for the salvage path rather than trapping the candidate here.
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
