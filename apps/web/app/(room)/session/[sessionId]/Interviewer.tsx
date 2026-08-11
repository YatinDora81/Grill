"use client";

import { cx } from "@/components/ui";
import type { useSpeech } from "@/hooks/useSpeech";

type Speech = ReturnType<typeof useSpeech>;

/**
 * Voice controls for the interviewer: mute and replay, nothing else. The voice
 * itself is chosen automatically (see PRIORITY in useSpeech) — picking one is
 * a decision nobody sitting in an interview wants to make.
 *
 * Renders nothing when the browser has no speech synthesis; the interview reads
 * fine silently, so an inert control would just be noise.
 */
export function Interviewer({
  speech,
  question,
  micLive,
}: {
  speech: Speech;
  question: string;
  micLive: boolean;
}) {
  if (!speech.supported) return null;

  // Square, like every other control in the redesign. No border: these sit
  // beside the question eyebrow, and two outlined boxes up there compete with
  // the follow-up chip directly below them.
  const btn =
    "flex size-8 items-center justify-center text-room-muted transition-colors hover:bg-room-raised hover:text-room-ink disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={speech.toggleMute}
        aria-label={speech.muted ? "Unmute the interviewer" : "Mute the interviewer"}
        aria-pressed={speech.muted}
        className={cx(btn, speech.muted && "text-room-ink")}
      >
        {speech.muted ? <VolumeXIcon /> : <VolumeIcon active={speech.speaking} />}
      </button>

      <button
        onClick={() => speech.speak(question)}
        aria-label="Replay the question"
        title={micLive ? "Not while the mic is live — it would land in your answer" : undefined}
        disabled={speech.muted || micLive}
        className={btn}
      >
        <ReplayIcon />
      </button>
    </div>
  );
}

function VolumeIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cx(active && "text-ember")}
    >
      <path
        d="M11 5 6 9H3v6h3l5 4V5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {active && (
        <path
          d="M18.5 5.5a9 9 0 0 1 0 13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function VolumeXIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M11 5 6 9H3v6h3l5 4V5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 12a9 9 0 1 0 3-6.7L3 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 3v5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
