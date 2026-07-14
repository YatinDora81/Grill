"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

const ASPECT = 4 / 3;
const MIN_W = 140;
const MAX_W = 520;
const MARGIN = 16;
const POS_KEY = "grill.selfview";

interface Box {
  x: number;
  y: number;
  w: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Keep the box on screen — a window resize must never strand it off-viewport. */
function fit(b: Box): Box {
  const w = clamp(b.w, MIN_W, Math.min(MAX_W, window.innerWidth - MARGIN * 2));
  const h = w / ASPECT;
  return {
    w,
    x: clamp(b.x, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN)),
    y: clamp(b.y, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN)),
  };
}

/**
 * Zoom-style self view: a mirrored picture-in-picture you can drag anywhere and
 * resize from the corner. Video only — the recorder owns the mic, and grabbing
 * audio here as well would fight it for the device.
 */
export function SelfView({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [box, setBox] = useState<Box | null>(null);

  // Position lives in state, not CSS, because dragging has to write it back.
  // Initialised on mount: bottom-right needs window dimensions, which don't
  // exist during SSR.
  useEffect(() => {
    let saved: Box | null = null;
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) saved = JSON.parse(raw) as Box;
    } catch {
      /* corrupt entry — fall through to the default corner */
    }
    const w = saved?.w ?? 240;
    setBox(
      fit(
        saved ?? {
          w,
          x: window.innerWidth - w - MARGIN,
          y: window.innerHeight - w / ASPECT - MARGIN * 4,
        },
      ),
    );
  }, []);

  useEffect(() => {
    const onResize = () => setBox((b) => (b ? fit(b) : b));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!box) return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(box));
    } catch {
      /* private mode: position just won't persist */
    }
  }, [box]);

  /**
   * The stream and the <video> can arrive in either order — the element only
   * mounts once `box` is measured, and getUserMedia resolves whenever it feels
   * like it. So attach from both sides and let whichever lands second do the
   * work. `autoPlay` alone isn't enough: the attribute is evaluated at mount,
   * long before srcObject exists, which leaves the element parked at
   * readyState 0. Starting it by hand is what actually shows a picture.
   */
  const streamRef = useRef<MediaStream | null>(null);
  const attach = useCallback(() => {
    const el = videoRef.current;
    const s = streamRef.current;
    if (!el || !s || el.srcObject === s) return;
    el.srcObject = s;
    void el.play().catch(() => {
      /* autoplay blocked: the frame stays dark, the interview is unaffected */
    });
  }, []);

  const setVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      attach();
    },
    [attach],
  );

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      .then((s) => {
        // Unmounted mid-request: release the camera rather than leave the light on.
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        attach();
      })
      .catch(() => {
        if (!cancelled) setError("Camera unavailable");
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [attach]);

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resize = useRef<{ x0: number; w0: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!box) return;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      if ((e.target as HTMLElement).dataset.handle === "resize") {
        resize.current = { x0: e.clientX, w0: box.w };
      } else {
        drag.current = { dx: e.clientX - box.x, dy: e.clientY - box.y };
      }
    },
    [box],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (drag.current) {
      const { dx, dy } = drag.current;
      setBox((b) => (b ? fit({ ...b, x: e.clientX - dx, y: e.clientY - dy }) : b));
    } else if (resize.current) {
      // Drag left to grow: the box lives in the bottom-right by default, so
      // pulling away from the corner reading as "bigger" is what people expect.
      const { x0, w0 } = resize.current;
      setBox((b) => (b ? fit({ ...b, w: w0 + (x0 - e.clientX) }) : b));
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    resize.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  if (!box) return null;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ left: box.x, top: box.y, width: box.w, height: box.w / ASPECT }}
      className="group fixed z-50 cursor-grab touch-none overflow-hidden rounded-xl border border-room-line bg-room-raised shadow-[0_22px_60px_-20px_rgba(0,0,0,0.9)] active:cursor-grabbing"
    >
      {error ? (
        <p className="flex h-full items-center justify-center px-3 text-center text-xs text-room-muted">
          {error}
        </p>
      ) : (
        <video
          ref={setVideo}
          autoPlay
          muted
          playsInline
          // Mirrored: you expect your own reflection, not a stranger's view.
          className="h-full w-full -scale-x-100 object-cover"
        />
      )}

      <button
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Turn the camera off"
        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-room/70 text-room-ink opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Resize grip. `data-handle` is what the pointer-down reads to tell a
          resize from a drag. */}
      <span
        data-handle="resize"
        aria-hidden
        className="absolute bottom-0 left-0 size-5 cursor-nesw-resize opacity-0 transition-opacity group-hover:opacity-100"
      >
        <span
          data-handle="resize"
          className="absolute bottom-1 left-1 block size-2 rounded-full bg-room-ink/60"
        />
      </span>
    </div>
  );
}

export function CameraToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? "Turn the camera off" : "Turn the camera on"}
      className={cx(
        "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-room-raised",
        on ? "text-room-ink" : "text-room-muted",
      )}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect
          x="2"
          y="6"
          width="13"
          height="12"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path d="m15 11 6-3.5v9L15 13" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        {!on && <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      </svg>
    </button>
  );
}
