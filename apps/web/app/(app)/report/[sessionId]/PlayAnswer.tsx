"use client";

import { useEffect, useRef, useState } from "react";
import type { PresignResponse } from "@repo/types";
import { apiGet } from "@/lib/apiClient";
import { Spinner, cx } from "@/components/ui";

/**
 * Plays back a turn's recording. The URL is presigned on demand and short-lived,
 * so it's fetched at press time rather than embedded in the page — a signed R2
 * URL baked into HTML would outlive the view and leak the recording.
 */
export function PlayAnswer({
  sessionId,
  turnIndex,
}: {
  sessionId: string;
  turnIndex: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");

  useEffect(() => {
    // Don't leave audio playing after the component goes away.
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  async function toggle() {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const { url } = await apiGet<PresignResponse>(
        `/api/interview/audio/presign?session_id=${sessionId}&turn_index=${turnIndex}`,
      );
      const el = new Audio(url);
      audioRef.current = el;
      el.onended = () => setState("idle");
      el.onerror = () => setState("error");
      await el.play();
      setState("playing");
    } catch {
      setState("error");
    }
  }

  if (state === "error") {
    return <span className="text-xs text-ink-muted">Audio unavailable</span>;
  }

  return (
    <button
      onClick={toggle}
      // The pill renders 26px tall; the pseudo-element lifts the touch target to
      // ~44px without changing a pixel of the pill or the row it sits in.
      className={cx(
        "relative inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-xs transition-colors after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-[''] hover:bg-paper-sunken",
        state === "playing" ? "text-ember" : "text-ink-soft",
      )}
      aria-label={state === "playing" ? "Pause your answer" : "Play your answer"}
    >
      {state === "loading" ? (
        <Spinner className="size-3" />
      ) : state === "playing" ? (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <rect x="1" y="1" width="3" height="8" fill="currentColor" />
          <rect x="6" y="1" width="3" height="8" fill="currentColor" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1 1l8 4-8 4z" fill="currentColor" />
        </svg>
      )}
      {state === "playing" ? "Playing" : "Hear it"}
    </button>
  );
}
