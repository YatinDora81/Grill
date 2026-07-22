"use client";

import { useEffect, useRef, useState } from "react";
import type { PresignResponse } from "@repo/types";
import { apiGet } from "@/lib/apiClient";

/**
 * Plays back a turn's recording. The URL is presigned on demand and short-lived,
 * so it's fetched at press time rather than embedded in the page — a signed R2
 * URL baked into HTML would outlive the view and leak the recording.
 */
export function PlayAnswer({
  sessionId,
  turnIndex,
  label = "play",
}: {
  sessionId: string;
  turnIndex: number;
  /** "play" in the replay; "play answer" where it stands on its own. */
  label?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");

  useEffect(() => {
    // Don't leave audio playing after the component goes away — collapsing a
    // turn in the replay unmounts this.
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
    return <span className="mono-note">audio unavailable</span>;
  }

  return (
    <button
      type="button"
      className="btn btn-ghost btn-xs"
      onClick={toggle}
      aria-label={state === "playing" ? "Pause your answer" : "Play your answer"}
    >
      <span aria-hidden="true">{state === "playing" ? "❚❚" : "▶"}</span>
      {state === "loading" ? "loading…" : state === "playing" ? "playing" : label}
    </button>
  );
}
