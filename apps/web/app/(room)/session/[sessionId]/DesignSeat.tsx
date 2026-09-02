"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { AnswerResponse, DesignQuestionPayload, EndResponse, Persona } from "@repo/types";
import { apiPost, apiPostForm, ApiClientError } from "@/lib/apiClient";
import { personaLabel } from "@/lib/interviewMeta";
import { cx } from "@/components/ui";
import { GrillToaster } from "@/components/toast";
import { MiniMarkdown } from "@/components/MiniMarkdown";
import { useKeystrokes } from "@/hooks/useKeystrokes";
import { ExcalidrawBoard } from "./ExcalidrawBoard";
import { useRecorder } from "./useRecorder";
import { useSessionVideo } from "./useSessionVideo";
import { Progress, RecDot, ThankYou, fmtTime, useQuit, useRoomTheme } from "./RoomChrome";

interface Props {
  sessionId: string;
  name: string | null;
  role: string | null;
  numQuestions: number;
  answered: number;
  turnIndex: number;
  payload: DesignQuestionPayload;
  maxSeconds: number;
  maxBytes: number;
  persona: Persona | null;
  videoBitrate: number;
}

type Phase = "briefing" | "drawing" | "sending" | "finishing";

const EMPTY_BOARD = "Draw something first — even boxes and arrows.";

const EXPORT_FAILED = "The board wouldn't export. Try submitting again.";

const EXPORT_PADDING = 24;

const EXPORT_MAX_EDGE = 1_600;

const STALE_CODES = new Set(["turn_already_answered", "unknown_turn", "session_not_active"]);

function isStale(err: unknown): boolean {
  return err instanceof ApiClientError && STALE_CODES.has(err.code);
}

const SEAT_BANNER = "flex-none border-b border-line bg-paper-raised/60";
const SEAT_BANNER_IN =
  "mx-auto flex max-w-[1320px] items-center gap-2.5 px-[18px] py-1.5 font-mono text-[10.5px] tracking-[0.16em] text-ink uppercase sm:gap-3 sm:px-6 sm:py-2";

const TOOL_BTN =
  "border border-line px-3.5 py-1.5 font-mono text-[10.5px] tracking-[0.14em] uppercase transition-colors hover:border-ember hover:text-ember disabled:opacity-50 disabled:hover:border-line disabled:hover:text-ink-soft";

export function DesignSeat(props: Props) {
  const router = useRouter();
  const rec = useRecorder(props.maxSeconds);
  const video = useSessionVideo(props.sessionId, props.videoBitrate);
  const theme = useRoomTheme();

  const [phase, setPhase] = useState<Phase>("briefing");
  const [error, setError] = useState("");
  const [elements, setElements] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const shownAt = useRef(performance.now());
  const activity = useKeystrokes(shownAt.current);
  const drawn = useRef(0);
  const finishVideo = useRef<Promise<void> | null>(null);
  const capFired = useRef(false);

  const busy = phase === "sending" || phase === "finishing";

  useEffect(() => {
    if (phase === "briefing" && rec.state === "recording") setPhase("drawing");
  }, [phase, rec.state]);

  useEffect(() => {
    if (phase !== "drawing") return;
    const t = setInterval(
      () => setElapsed(Math.round((performance.now() - shownAt.current) / 1_000)),
      1_000,
    );
    return () => clearInterval(t);
  }, [phase]);

  const quit = useQuit(props.sessionId, () => {
    rec.reset();
    video.stream?.getTracks().forEach((t) => t.stop());
  });

  function onBoardChange(count: number) {
    if (count === drawn.current) return;
    activity.onEdit(drawn.current, count);
    drawn.current = count;
    setElements(count);
  }

  async function submit() {
    if (busy) return;
    const board = api.current;
    if (!board) {
      setError("The board hasn't finished loading yet.");
      return;
    }

    let png: Blob;
    let scene: string;
    try {
      const { exportToBlob, serializeAsJSON } = await import("@excalidraw/excalidraw");
      const sceneElements = board.getSceneElements();
      if (sceneElements.length === 0) {
        setError(EMPTY_BOARD);
        return;
      }

      const appState = board.getAppState();
      const files = board.getFiles();
      png = await exportToBlob({
        elements: sceneElements,
        appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
        files,
        mimeType: "image/png",
        exportPadding: EXPORT_PADDING,
        maxWidthOrHeight: EXPORT_MAX_EDGE,
      });
      scene = serializeAsJSON(sceneElements, appState, files, "local");
    } catch (err) {
      console.warn("[design] the board export failed:", err);
      setError(EXPORT_FAILED);
      return;
    }

    setPhase("sending");
    setError("");
    const stats = activity.finish();
    const send = async () => {
      const blob = await rec.stop();
      const form = new FormData();
      form.append("session_id", props.sessionId);
      form.append("turn_index", String(props.turnIndex));
      form.append("image", png, `turn_${props.turnIndex}.png`);
      form.append("scene", scene);
      form.append(
        "edits",
        JSON.stringify({
          first_edit_ms: stats.first_edit_ms,
          longest_idle_ms: stats.longest_idle_ms,
          final_elements: drawn.current,
        }),
      );
      if (blob && blob.size <= props.maxBytes) {
        form.append("audio", blob, `turn_${props.turnIndex}.webm`);
      }
      const res = await apiPostForm<AnswerResponse>("/api/interview/answer-design", form);
      if (res.done) {
        setPhase("finishing");
        finishVideo.current = video.finish();
        try {
          await apiPost<EndResponse>("/api/interview/end", { session_id: props.sessionId });
        } catch {}
        return;
      }
      router.refresh();
    };

    try {
      await toast.promise(send(), {
        loading: "Sending the board…",
        success: "Board in — the interviewer is reading it",
        error: (err: unknown) =>
          isStale(err)
            ? "You're already past this one — catching up…"
            : err instanceof ApiClientError
              ? err.message
              : "Couldn't send that board.",
      });
    } catch (err) {
      if (isStale(err)) {
        setError("");
        router.refresh();
        return;
      }
      setError(err instanceof ApiClientError ? err.message : "Couldn't send that board.");
      setPhase("drawing");
    }
  }

  const capSubmit = useRef(submit);
  capSubmit.current = submit;
  useEffect(() => {
    if (!rec.capped || phase !== "drawing" || capFired.current) return;
    capFired.current = true;
    void capSubmit.current();
  }, [rec.capped, phase]);

  if (phase === "finishing") {
    return <ThankYou sessionId={props.sessionId} saving={finishVideo.current} />;
  }

  const currentQ = Math.min(props.answered + 1, props.numQuestions);
  const micOff = !rec.supported || rec.state === "denied" || Boolean(rec.error);

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

          <Progress answered={props.answered} total={props.numQuestions} />

          <div className="room-ctl">
            <span className="border border-line px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] whitespace-nowrap uppercase text-ink-muted max-sm:hidden">
              {personaLabel(props.persona)}
            </span>
            <RecDot state={video.state} />
            <button onClick={quit} disabled={busy} className="underlink">
              Leave
            </button>
          </div>
        </div>
      </header>

      <div className={SEAT_BANNER} aria-live="polite">
        <div className={SEAT_BANNER_IN}>
          <span
            aria-hidden="true"
            className={cx(
              "size-2 flex-none rounded-full",
              phase === "drawing" && rec.state === "recording"
                ? "bg-ember animate-pulse-rec"
                : "bg-mixed",
            )}
          />
          <span className="min-w-0 truncate">
            {phase === "sending"
              ? "Got it — reading the board and scoring the design"
              : phase === "briefing"
                ? "Read the brief, then start when you're ready"
                : rec.state === "recording"
                  ? "Drawing — the mic is open, talk it through"
                  : "Drawing — no mic on this one"}
          </span>
          <em className="truncate not-italic tracking-[0.1em] text-ink-muted max-sm:hidden">
            ·{" "}
            {phase === "briefing"
              ? "the clock starts when you do"
              : "label every box; the reviewer only reads what is drawn"}
          </em>
        </div>
      </div>

      <main className="room-main">
        <div className="mx-auto w-full max-w-[1320px] px-4 py-5 sm:px-6">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <section className="min-w-0">
              <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                Design {Math.ceil(currentQ / 2)} · technical
              </p>
              <h1 className="mt-2 font-display text-[22px] leading-[1.1] font-extrabold tracking-[-0.02em] sm:text-[26px]">
                {props.payload.title}
              </h1>
              {props.payload.scale ? (
                <p className="mt-2.5 inline-block border border-line px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-ink-muted uppercase">
                  scale · {props.payload.scale}
                </p>
              ) : null}

              <div className="mt-4">
                <MiniMarkdown text={props.payload.prompt_markdown} />
              </div>

              {props.payload.requirements.length > 0 && (
                <div className="mt-6">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                    Requirements
                  </p>
                  <ul className="mt-2 grid gap-1.5">
                    {props.payload.requirements.map((r, i) => (
                      <li
                        key={i}
                        className="border-l-2 border-line py-1 pl-3 text-[13px] leading-relaxed text-ink-soft"
                      >
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {props.payload.focus.length > 0 && (
                <div className="mt-6">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                    They will push on
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {props.payload.focus.map((f, i) => (
                      <span
                        key={i}
                        className="border border-line px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-ink-muted uppercase"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {phase === "briefing" && (
                <div className="mt-7">
                  {micOff ? (
                    <button onClick={() => setPhase("drawing")} className="btn btn-primary">
                      Start without the mic
                    </button>
                  ) : (
                    <button
                      onClick={() => rec.start()}
                      disabled={rec.state === "requesting"}
                      className="btn btn-primary"
                    >
                      {rec.state === "requesting"
                        ? "Waiting for the mic…"
                        : "Start the design — mic on"}
                    </button>
                  )}
                  <p className="mt-3 max-w-[52ch] font-mono text-[10px] leading-relaxed tracking-[0.14em] text-ink-muted uppercase">
                    {micOff
                      ? "No microphone on this one — the board is still reviewed, but nothing you say is recorded."
                      : "The mic records the whole design so the review can weigh what you said against what you drew."}
                  </p>
                </div>
              )}
            </section>

            <section className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-center gap-2 border border-line p-2">
                <span className="font-mono text-[10.5px] tracking-[0.14em] text-ink-muted uppercase tabular-nums">
                  {elements} {elements === 1 ? "shape" : "shapes"}
                </span>

                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={phase !== "drawing"}
                  className={cx(TOOL_BTN, "border-ink bg-ink text-paper hover:bg-ember")}
                >
                  {busy ? "Sending…" : "Submit design"}
                </button>

                <span className="ml-auto font-mono text-[10.5px] tracking-[0.14em] text-ink-muted uppercase tabular-nums">
                  {fmtTime(rec.state === "recording" ? rec.seconds : elapsed)}
                  {rec.state === "recording"
                    ? ` · ${fmtTime(Math.max(0, props.maxSeconds - rec.seconds))} left`
                    : ""}
                </span>
              </div>

              <div className="mt-2 border border-line">
                <ExcalidrawBoard
                  theme={theme}
                  onReady={(instance) => {
                    api.current = instance;
                  }}
                  onChange={onBoardChange}
                />
              </div>

              {(error || rec.error) && (
                <p className="error-note mt-3" role="alert" key={error || rec.error}>
                  {error || rec.error}
                </p>
              )}
            </section>
          </div>
        </div>
      </main>

      <footer className="room-foot">
        <p>The board never leaves your machine until you submit it.</p>
        <p>The mic stays on so the review can weigh what you said against what you drew.</p>
      </footer>
    </div>
  );
}
