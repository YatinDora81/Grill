"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EndResponse, Persona } from "@repo/types";
import { apiPatch, apiPost, ApiClientError } from "@/lib/apiClient";
import { personaLabel } from "@/lib/interviewMeta";
import { cx } from "@/components/ui";
import { GrillToaster } from "@/components/toast";
import { useGeminiLive, type LiveLog } from "@/hooks/useGeminiLive";
import { Progress, ThankYou, fmtTime, useQuit } from "./RoomChrome";

interface Props {
  sessionId: string;
  name: string | null;
  role: string | null;
  numQuestions: number;
  persona: Persona | null;
  maxMinutes: number;
}

type Phase = "ready" | "live" | "saving" | "done" | "failed";

const SAVE_FAILED = "The conversation wouldn't save.";
const OPT_OUT_FAILED = "Couldn't switch this interview back to the standard format.";

const SEAT_BANNER = "flex-none border-b border-line bg-paper-raised/60";
const SEAT_BANNER_IN =
  "mx-auto flex max-w-[880px] items-center gap-2.5 px-[18px] py-1.5 font-mono text-[10.5px] tracking-[0.16em] text-ink uppercase sm:gap-3 sm:px-6 sm:py-2";

const LEVEL_BARS = 32;

function Meter({ level, live }: { level: number; live: boolean }) {
  const lit = Math.min(LEVEL_BARS, Math.round(Math.sqrt(level) * LEVEL_BARS * 1.6));
  return (
    <div className="flex h-10 items-end gap-[3px]" aria-hidden="true">
      {Array.from({ length: LEVEL_BARS }).map((_, i) => (
        <span
          key={i}
          className={cx(
            "w-full flex-1 transition-[height,background-color] duration-75",
            i < lit && live ? "bg-ember" : "bg-line",
          )}
          style={{ height: `${20 + (i < lit && live ? 80 * (i / LEVEL_BARS) + 20 : 0)}%` }}
        />
      ))}
    </div>
  );
}

export function LiveSeat(props: Props) {
  const router = useRouter();
  const live = useGeminiLive(props.sessionId, props.maxMinutes);

  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState("");
  const [optingOut, setOptingOut] = useState(false);
  const savingRef = useRef(false);
  const phaseRef = useRef<Phase>("ready");
  const leavingRef = useRef(false);
  phaseRef.current = phase;

  const save = useCallback(
    async (pairs: LiveLog[]) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setPhase("saving");
      setError("");
      try {
        await apiPost("/api/interview/live/complete", {
          session_id: props.sessionId,
          turns: pairs,
        });
      } catch (err) {
        if (!(err instanceof ApiClientError && err.code === "already_completed")) {
          savingRef.current = false;
          setError(err instanceof ApiClientError ? err.message : SAVE_FAILED);
          setPhase("failed");
          return;
        }
      }
      try {
        await apiPost<EndResponse>("/api/interview/end", { session_id: props.sessionId });
      } catch (err) {
        console.warn("[live] the report build did not start from the room:", err);
      }
      setPhase("done");
    },
    [props.sessionId],
  );

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (live.state === "live") {
      setPhase("live");
      setError("");
      return;
    }
    if (live.state === "failed") {
      setError(live.error);
      setPhase((p) => (p === "saving" || p === "done" ? p : "failed"));
      return;
    }
    if (live.state === "ended" && phaseRef.current === "live" && !leavingRef.current) {
      void saveRef.current(live.log);
    }
  }, [live.state, live.error, live.log]);

  const quit = useQuit(props.sessionId, () => {
    leavingRef.current = true;
    void live.end();
  });

  async function begin() {
    setError("");
    await live.start();
  }

  async function finish() {
    const pairs = await live.end();
    await save(pairs);
  }

  async function optOut() {
    if (optingOut) return;
    setOptingOut(true);
    try {
      await live.end();
      await apiPatch("/api/interview/live/opt-out", { session_id: props.sessionId });
      router.refresh();
    } catch (err) {
      setOptingOut(false);
      setError(err instanceof ApiClientError ? err.message : OPT_OUT_FAILED);
    }
  }

  if (phase === "done") return <ThankYou sessionId={props.sessionId} saving={null} />;

  const answered = live.log.length;
  const currentQ = Math.min(answered + 1, props.numQuestions);
  const connecting = live.state === "connecting";
  const remaining = Math.max(0, props.maxMinutes * 60 - live.elapsedS);
  const nothingSaid = live.log.length === 0;

  const banner =
    phase === "saving"
      ? "Got it — writing the conversation down and scoring it"
      : phase === "failed"
        ? "The live interviewer stopped"
        : phase === "live"
          ? live.modelSpeaking
            ? "The interviewer is talking — cut in whenever you want"
            : live.userSpeaking
              ? "Listening"
              : "Your turn"
          : connecting
            ? "Opening the line"
            : "Read this, then start when you're ready";

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
            <span className="border border-line px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] whitespace-nowrap uppercase text-ember">
              live
            </span>
            <button onClick={quit} disabled={phase === "saving"} className="underlink">
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
              phase === "live" ? "bg-ember animate-pulse-rec" : "bg-mixed",
            )}
          />
          <span className="min-w-0 truncate">{banner}</span>
          {phase === "live" && (
            <em className="ml-auto truncate not-italic tracking-[0.1em] text-ink-muted tabular-nums">
              {fmtTime(live.elapsedS)} · {fmtTime(remaining)} left
            </em>
          )}
        </div>
      </div>

      <main className="room-main">
        <div className="room-in">
          <div className="room-center">
            {phase === "ready" && (
              <div className="max-w-[62ch]">
                <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                  Live conversation · experimental
                </p>
                <h1 className="mt-3 font-display text-[26px] leading-[1.1] font-extrabold tracking-[-0.02em] sm:text-[30px]">
                  The interviewer talks back.
                </h1>
                <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
                  No recording, no upload between answers — you speak, it answers, and you can talk
                  over it the way you would in the room. When it is done, the questions and your
                  answers are scored like any other interview.
                </p>
                <ul className="mt-5 grid gap-2">
                  {[
                    "Pace, tone, pauses and camera are not measured in live mode — the report says so.",
                    "Nothing is recorded. Only the transcript of what was said is kept.",
                    `The line closes after ${props.maxMinutes} minutes, and what was said by then is saved.`,
                  ].map((line) => (
                    <li
                      key={line}
                      className="border-l-2 border-line py-1 pl-3 text-[13px] leading-relaxed text-ink-soft"
                    >
                      {line}
                    </li>
                  ))}
                </ul>

                <div className="mt-7 flex flex-wrap items-center gap-4">
                  <button
                    onClick={() => void begin()}
                    disabled={connecting}
                    className="btn btn-primary"
                  >
                    {connecting ? "Opening the line…" : "Start the conversation"}
                  </button>
                  <span className="mono-note">the mic opens as soon as you press it</span>
                </div>
              </div>
            )}

            {phase === "live" && (
              <div className="max-w-[62ch]">
                <Meter level={live.level} live={live.userSpeaking || !live.modelSpeaking} />

                <div className="mt-6 border-t border-line pt-4">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                    Interviewer
                  </p>
                  <p className="mt-2 min-h-[3em] text-[17px] leading-[1.5] text-ink">
                    {live.liveQuestion || "…"}
                  </p>
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                    You
                  </p>
                  <p className="mt-2 min-h-[3em] text-[15px] leading-[1.5] text-ink-soft">
                    {live.liveAnswer || "…"}
                  </p>
                </div>

                <div className="mt-7 flex flex-wrap items-center gap-4">
                  <button onClick={() => void finish()} className="btn btn-primary">
                    End interview
                  </button>
                  <span className="mono-note">
                    {answered} {answered === 1 ? "exchange" : "exchanges"} so far
                  </span>
                </div>
              </div>
            )}

            {phase === "saving" && (
              <div className="max-w-[62ch]">
                <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">
                  Saving
                </p>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  Writing down what was said and scoring every answer.
                </p>
              </div>
            )}

            {phase === "failed" && (
              <div className="max-w-[62ch]">
                <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-weak">
                  Live mode stopped
                </p>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                  {error || "The live interviewer went away."}
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-4">
                  {nothingSaid ? (
                    <>
                      <button
                        onClick={() => void optOut()}
                        disabled={optingOut}
                        className="btn btn-primary"
                      >
                        {optingOut ? "Switching…" : "Run the standard interview instead"}
                      </button>
                      <button
                        onClick={() => void begin()}
                        disabled={optingOut || connecting}
                        className="underlink"
                      >
                        try the live line again
                      </button>
                    </>
                  ) : (
                    <button onClick={() => void save(live.log)} className="btn btn-primary">
                      Save what was said
                    </button>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </main>

      <footer className="room-foot">
        <p>
          Live mode is experimental. Pace, tone and camera are not measured — only what was said.
        </p>
        <p>The audio is not recorded; the transcript is.</p>
      </footer>
    </div>
  );
}
