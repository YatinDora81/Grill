"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/apiClient";

export function VideoPlayer({
  videoId,
  offsetMs,
  turnNumber,
  expiresInDays,
}: {
  videoId: string;
  offsetMs: number;
  turnNumber: number;
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
    void el.play?.()?.catch?.(() => {});
  }, []);

  const seekToOffset = useCallback(() => {
    const el = videoRef.current;
    if (!el || seeked.current) return;
    const target = offsetMs / 1000;

    if (el.duration === Infinity || Number.isNaN(el.duration)) {
      const onUpdate = () => {
        el.removeEventListener("timeupdate", onUpdate);
        el.currentTime = Math.min(target, el.duration || target);
        seeked.current = true;
        start();
      };
      el.addEventListener("timeupdate", onUpdate);
      el.currentTime = 1e101;
      return;
    }
    el.currentTime = Math.min(target, el.duration);
    seeked.current = true;
    start();
  }, [offsetMs, start]);

  function onPress() {
    if (!open || error) {
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
    if (e.detail === 0) return;
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
  }

  const progress = duration > 0 ? (time / duration) * 100 : 0;
  const meta =
    `starts at ${fmt(offsetMs)}` +
    (expiresInDays !== null ? ` · ${expiryPhrase(expiresInDays)}` : "");

  if (!open) {
    return (
      <div>
        <p className="tr-label">Watch yourself answer</p>
        <button
          type="button"
          className="tape"
          onClick={onPress}
          aria-label={`Play your answer to question ${turnNumber}`}
        >
          <span className="tape-play" aria-hidden="true">
            ▶
          </span>
          <span className="tape-meta">
            <span className="tape-t">Your answer, on camera</span>
            <span className="tape-sub">{meta}</span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="tr-label">Watch yourself answer</p>
      <div className="deck" data-playing={playing}>
        <div className="deck-screen">
          {url ? (
            <video
              ref={videoRef}
              src={url}
              playsInline
              preload="metadata"
              className="deck-el"
              onClick={onPress}
              onLoadedMetadata={seekToOffset}
              onTimeUpdate={onTimeUpdate}
              onDurationChange={onTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
          ) : null}
          {!playing && (
            <button
              type="button"
              className="deck-poster"
              onClick={onPress}
              disabled={loading}
              aria-label={
                error ? "Try loading the video again" : `Play your answer to question ${turnNumber}`
              }
            >
              {loading ? <span className="spinner" aria-hidden="true" /> : "▶"}
            </button>
          )}
        </div>

        <div className="deck-ctl">
          <button
            type="button"
            className="deck-btn"
            onClick={onPress}
            disabled={loading}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <button type="button" className="deck-skip" onClick={() => seekBy(-5)}>
            −5s
          </button>
          <button type="button" className="deck-skip" onClick={() => seekBy(5)}>
            +5s
          </button>
          <button
            type="button"
            className="deck-track"
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
            <span className="deck-prog" style={{ width: `${progress}%` }} />
          </button>
          <span className="deck-time">
            {fmt(time * 1000)} / {duration > 0 ? fmt(duration * 1000) : "—:—"}
          </span>
          <span className="deck-rec" aria-hidden="true">
            <span className="deck-dot" />
            rec
          </span>
        </div>
      </div>
      {error ? (
        <p className="mono-note mono-note-error" role="alert" style={{ marginTop: 7 }}>
          {error} press play to try again
        </p>
      ) : null}
      <p className="mono-note" style={{ marginTop: 7 }}>
        synced to the session tape · {meta}
      </p>
    </div>
  );
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function expiryPhrase(days: number): string {
  if (days <= 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days} days`;
}
