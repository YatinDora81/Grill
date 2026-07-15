"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/apiClient";
import { Spinner, cx } from "@/components/ui";

/**
 * The video of one answer.
 *
 * Opens closed and mints its URL on demand: a report with 40 turns must not
 * fetch 40 presigned URLs and start 40 <video> elements downloading.
 *
 * Seeking is the hard part. MediaRecorder's webm has no Duration element and no
 * Cues — `video.duration` comes back Infinity and a naive `currentTime = x`
 * either no-ops or lands nowhere. The fix below is the standard one: seek past
 * the end first, which forces the browser to scan to the real end and populate
 * duration, and only then seek to the offset we actually want.
 */
export function WatchAnswer({ videoId, offsetMs }: { videoId: string; offsetMs: number }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const seeked = useRef(false);

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

  /**
   * Force the browser to work out the real duration, then seek.
   *
   * Without the first hop, a MediaRecorder webm reports duration Infinity and
   * the seek is ignored — the video just plays from the top and the offset we
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
      };
      el.addEventListener("timeupdate", onUpdate);
      el.currentTime = 1e101; // past any real end — forces the scan
      return;
    }
    el.currentTime = Math.min(target, el.duration);
    seeked.current = true;
  }, [offsetMs]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  /**
   * A fragment, not a wrapper: the trigger and the player are siblings in the
   * Card's wrapping header row, so `order-last w-full` drops the player onto
   * its own full-width line. Wrapped in a div, the player inherited the trigger
   * cluster's `shrink-0` content-sized box — `w-full` against a content-sized
   * containing block is cyclic, so the video sized itself from its intrinsic
   * dimensions and shoved the whole report into horizontal scroll.
   */
  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        // ~57x44 hit target from the pseudo-element. A padded box would inflate
        // this deliberately tight header row at every width, phone or not.
        className="relative font-mono text-[11px] text-ink-muted underline underline-offset-4 transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-[''] hover:text-ember"
      >
        {open ? "Hide" : "Watch"}
      </button>

      {open ? (
        <div className="order-last w-full">
          <span className="font-mono text-[11px] text-ink-muted">
            Video · from {fmt(offsetMs)}
          </span>
          <div
            className={cx(
              "mt-2 flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-line bg-paper-sunken",
            )}
          >
            {loading ? <Spinner className="text-ember" /> : null}
            {error ? <p className="px-4 text-center text-xs text-weak">{error}</p> : null}
            {url ? (
              <video
                ref={videoRef}
                src={url}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={seekToOffset}
                // NOT mirrored, unlike SelfView. The flip there is a live-preview
                // affordance — you expect your own reflection to move with you.
                // The recorded file is never flipped, so mirroring it on playback
                // reverses the real room and any text in it.
                className="h-full w-full object-contain"
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function fmt(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
