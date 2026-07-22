"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/apiClient";

/**
 * The tape: one answer's slice of the session recording.
 *
 * Starts as a poster and mints its URL on demand — a report with 40 turns must
 * not fetch 40 presigned URLs and start 40 <video> elements downloading.
 *
 * Seeking is the hard part. MediaRecorder's webm has no Duration element and no
 * Cues, so `video.duration` comes back Infinity and a naive `currentTime = x`
 * either no-ops or lands nowhere. The fix below is the standard one: seek past
 * the end first, which forces the browser to scan to the real end and populate
 * duration, and only then seek to the offset we actually want.
 *
 * Collapsing the turn unmounts this whole component, so a reopened turn gets a
 * fresh element that has to be seeked again — which is exactly what happens.
 */
export function VideoPlayer({
  videoId,
  offsetMs,
  turnNumber,
  expiresInDays,
}: {
  videoId: string;
  offsetMs: number;
  /** 1-based, for the play button's label. */
  turnNumber: number;
  /** From SessionVideo.expiresAt. Null when the row didn't carry one. */
  expiresInDays: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seeked = useRef(false);
  /** Set when the user pressed play to open — so the seek can roll straight on. */
  const autoplay = useRef(false);

  const load = useCallback(async () => {
    if (url || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiPost<{ url: string }>("/api/interview/video/presign", {
        video_id: videoId,
      });
      setUrl(res.url);
    } catch {
      setError("Couldn't load the video.");
    } finally {
      setLoading(false);
    }
  }, [videoId, url, loading]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const start = useCallback(() => {
    const el = videoRef.current;
    if (!el || !autoplay.current) return;
    autoplay.current = false;
    void el.play?.()?.catch?.(() => {
      /* autoplay refused — the poster button is still there to press */
    });
  }, []);

  /**
   * Force the browser to work out the real duration, then seek.
   *
   * Without the first hop, a MediaRecorder webm reports duration Infinity and
   * the seek is ignored — the answer just plays from the top and the offset we
   * carefully measured does nothing.
   */
  const seekToOffset = useCallback(() => {
    const el = videoRef.current;
    if (!el || seeked.current) return;
    const target = offsetMs / 1000;

    if (el.duration === Infinity || Number.isNaN(el.duration)) {
      const onUpdate = () => {
        el.removeEventListener("timeupdate", onUpdate);
        // Duration is real now; take the seek we actually wanted.
        el.currentTime = Math.min(target, el.duration || target);
        seeked.current = true;
        start();
      };
      el.addEventListener("timeupdate", onUpdate);
      el.currentTime = 1e101; // past any real end — forces the scan
      return;
    }
    el.currentTime = Math.min(target, el.duration);
    seeked.current = true;
    start();
  }, [offsetMs, start]);

  function onPress() {
    if (!open || error) {
      // Clearing the error is what makes a failed presign retryable: `load`
      // bails only on a URL it already has, and a failure leaves that null.
      setError("");
      autoplay.current = true;
      if (!open) setOpen(true);
      else void load();
      return;
    }
    const el = videoRef.current;
    if (!el) return;
    if (playing) el.pause();
    else void el.play?.()?.catch?.(() => {});
  }

  // Ignored while the forced scan is in flight: duration is Infinity or NaN
  // then, and currentTime is 1e101, which would paint a nonsense bar.
  function onTimeUpdate() {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    setDuration(el.duration);
    setTime(Math.min(el.currentTime, el.duration));
  }

  function seekBy(seconds: number) {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = Math.max(0, Math.min(el.currentTime + seconds, el.duration));
  }

  function scrub(e: React.MouseEvent<HTMLButtonElement>) {
    // `detail === 0` means Enter or Space, not a pointer. Those clicks report
    // clientX 0, which would compute ratio 0 and throw the playhead back to the
    // top of the session tape — the one thing the offset seek exists to avoid.
    // Keyboard users move the playhead with the arrow keys below instead.
    if (e.detail === 0) return;
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
  }

  const progress = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div>
      <p className="tr-label">Watch yourself answer</p>
      <div className="vid" data-playing={playing}>
        <div className="vid-glow" aria-hidden="true" />

        {url ? (
          <video
            ref={videoRef}
            src={url}
            playsInline
            preload="metadata"
            className="vid-el"
            onLoadedMetadata={seekToOffset}
            onTimeUpdate={onTimeUpdate}
            onDurationChange={onTimeUpdate}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        ) : (
          <svg className="vsil" viewBox="0 0 200 120" aria-hidden="true">
            <circle cx="100" cy="42" r="26" fill="currentColor" />
            <path d="M38 120 C38 84 74 72 100 72 C126 72 162 84 162 120 Z" fill="currentColor" />
          </svg>
        )}

        <span className="vcorner tl" aria-hidden="true" />
        <span className="vcorner br" aria-hidden="true" />

        {/* The button stays put on failure — pressing it again is the retry. */}
        <button
          type="button"
          className="vid-play"
          onClick={onPress}
          disabled={loading}
          aria-label={
            error
              ? "Try loading the video again"
              : playing
                ? "Pause"
                : `Play your answer to question ${turnNumber}`
          }
        >
          {loading ? <span className="spinner" aria-hidden="true" /> : playing ? "❚❚" : "▶"}
        </button>

        <div className="vid-bar">
          <span className="vid-rec">
            <span className="vid-dot" aria-hidden="true" />
            rec
          </span>
          <button
            type="button"
            className="vid-track"
            onClick={scrub}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                seekBy(-5);
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                seekBy(5);
              }
            }}
            aria-label="Seek. Left and right arrows move five seconds."
          >
            <span className="vid-prog" style={{ width: `${progress}%` }} />
          </button>
          <span className="vid-time">
            {fmt(time * 1000)} / {duration > 0 ? fmt(duration * 1000) : "—:—"}
          </span>
        </div>
      </div>
      {error ? (
        <p className="mono-note" role="alert" style={{ marginTop: 7, color: "var(--color-weak)" }}>
          {error} press play to try again
        </p>
      ) : null}
      <p className="mono-note" style={{ marginTop: 7 }}>
        synced to the session tape · starts at {fmt(offsetMs)}
        {expiresInDays !== null ? ` · ${expiryPhrase(expiresInDays)}` : ""}
      </p>
    </div>
  );
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Retention, in words. "expires in 1 days" is how you lose someone's trust in a footnote. */
function expiryPhrase(days: number): string {
  if (days <= 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days} days`;
}
