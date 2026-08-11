"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { PresignResponse } from "@repo/types";
import { apiGet } from "@/lib/apiClient";

export interface PlayAnswerHandle {
  seekTo(seconds: number): void;
}

/**
 * Plays back a turn's recording. The URL is presigned on demand and short-lived,
 * so it's fetched at press time rather than embedded in the page — a signed R2
 * URL baked into HTML would outlive the view and leak the recording.
 */
export function PlayAnswer({
  sessionId,
  turnIndex,
  label = "play",
  onTime,
  seekRef,
  scrubber = false,
}: {
  sessionId: string;
  turnIndex: number;
  /** "play" in the replay; "play answer" where it stands on its own. */
  label?: string;
  onTime?: (seconds: number | null) => void;
  seekRef?: RefObject<PlayAnswerHandle | null>;
  scrubber?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const frameRef = useRef<number | null>(null);
  const onTimeRef = useRef(onTime);
  const pendingSeekRef = useRef<number | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    onTimeRef.current = onTime;
  }, [onTime]);

  const cancelClock = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const stopClock = useCallback(() => {
    cancelClock();
    onTimeRef.current?.(null);
  }, [cancelClock]);

  const startClock = useCallback(() => {
    if ((!onTimeRef.current && !scrubber) || frameRef.current !== null) return;
    const tick = () => {
      const el = audioRef.current;
      if (!el) {
        frameRef.current = null;
        return;
      }
      if (scrubber) {
        setPosition(el.currentTime);
        setDuration(playableDuration(el));
      }
      onTimeRef.current?.(el.currentTime);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [scrubber]);

  useEffect(() => {
    // Don't leave audio playing after the component goes away — collapsing a
    // turn in the replay unmounts this.
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      stopClock();
    };
  }, [stopClock]);

  async function play(el: HTMLAudioElement) {
    try {
      await el.play();
      setState("playing");
      startClock();
    } catch {
      setState("error");
      stopClock();
    }
  }

  function seekTo(seconds: number) {
    const el = audioRef.current;
    if (!el) {
      pendingSeekRef.current = seconds;
      if (!loadingRef.current) void toggle();
      return;
    }
    el.currentTime = seconds;
    setPosition(seconds);
    onTimeRef.current?.(seconds);
    if (el.paused) void play(el);
  }

  useImperativeHandle(seekRef, () => ({ seekTo }));

  async function toggle() {
    if (loadingRef.current) return;
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      cancelClock();
      return;
    }
    loadingRef.current = true;
    setState("loading");
    try {
      const { url } = await apiGet<PresignResponse>(
        `/api/interview/audio/presign?session_id=${sessionId}&turn_index=${turnIndex}`,
      );
      const el = new Audio(url);
      audioRef.current = el;
      el.onended = () => {
        setState("idle");
        stopClock();
      };
      el.onerror = () => {
        setState("error");
        stopClock();
      };
      await el.play();
      const seek = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (seek !== null) el.currentTime = seek;
      setState("playing");
      startClock();
    } catch {
      pendingSeekRef.current = null;
      setState("error");
      stopClock();
    } finally {
      loadingRef.current = false;
    }
  }

  if (state === "error") {
    return <span className="mono-note">audio unavailable</span>;
  }

  const at = duration > 0 ? Math.max(0, Math.min(position, duration)) : 0;

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={toggle}
        aria-label={state === "playing" ? "Pause your answer" : "Play your answer"}
      >
        <span aria-hidden="true">{state === "playing" ? "❚❚" : "▶"}</span>
        {state === "loading" ? "loading…" : state === "playing" ? "playing" : label}
      </button>
      {scrubber && duration > 0 ? (
        <span className="flex min-w-40 flex-1 items-center gap-2.5">
          <input
            type="range"
            className="range"
            min={0}
            max={duration}
            step={0.1}
            value={at}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Seek within your answer"
            aria-valuetext={`${clock(at)} of ${clock(duration)}`}
            style={{ "--fill": `${(at / duration) * 100}%` } as CSSProperties}
          />
          <span className="mono-note shrink-0">
            {clock(at)} / {clock(duration)}
          </span>
        </span>
      ) : null}
    </>
  );
}

function playableDuration(el: HTMLAudioElement): number {
  return Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
