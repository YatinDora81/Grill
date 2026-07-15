"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

const ASPECT = 4 / 3;
const MIN_W = 140;
const MAX_W = 520;
const MARGIN = 16;
const POS_KEY = "grill.selfview";

/**
 * The box is sized as a FRACTION of the viewport, not in absolute pixels.
 * A flat 240px default is 16% of a desktop window and 64% of a 375px phone —
 * at phone size it landed squarely on top of the record button, and since this
 * is `fixed z-50` with pointer handlers, it ate the tap. The candidate couldn't
 * start recording at all. The floor scales for the same reason.
 */
const DEFAULT_W = 240;
const DEFAULT_W_VW = 0.3;
const MIN_W_VW = 0.25;

interface Box {
  x: number;
  y: number;
  w: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The starting size: 240px on a desktop, ~30% of the screen on a phone. */
function defaultWidth(): number {
  return Math.min(DEFAULT_W, Math.round(window.innerWidth * DEFAULT_W_VW));
}

/** The corner every interview opens in. */
function bottomRight(w: number): Box {
  return {
    w,
    x: window.innerWidth - w - MARGIN,
    // MARGIN * 4, not MARGIN: the bottom strip is where the record button lives,
    // and this is `fixed z-50` with pointer handlers — flush to the edge it would
    // sit on top of the control and eat the tap.
    y: window.innerHeight - w / ASPECT - MARGIN * 4,
  };
}

/** Keep the box on screen — a window resize must never strand it off-viewport. */
function fit(b: Box): Box {
  // On a phone even MIN_W is a third of the screen, so the floor has to give.
  const minW = Math.min(MIN_W, window.innerWidth * MIN_W_VW);
  const w = clamp(b.w, minW, Math.min(MAX_W, window.innerWidth - MARGIN * 2));
  const h = w / ASPECT;
  return {
    w,
    x: clamp(b.x, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN)),
    y: clamp(b.y, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN)),
  };
}

/**
 * Zoom-style self view: a mirrored picture-in-picture you can drag anywhere and
 * resize from the corner.
 *
 * A pure VIEW of a stream it does not own. It used to call getUserMedia itself
 * and stop the tracks on unmount — which was fine when the camera existed only
 * to be looked at, and became a bug the moment the session was being recorded:
 * closing the PiP would have silently ended the recording. The stream (and its
 * lifetime) belong to useSessionVideo now; this just paints it.
 */
export function SelfView({ stream, onClose }: { stream: MediaStream | null; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  // Position lives in state, not CSS, because dragging has to write it back.
  // Initialised on mount: the corner needs window dimensions, which don't exist
  // during SSR.
  //
  // SIZE is restored from the last session; POSITION deliberately is not. Every
  // interview opens in the bottom-right, because where the box was dragged to
  // during some earlier interview says nothing about where it should sit in
  // this one — that room had a different question on screen, possibly at a
  // different window size. Dragging still works; it just doesn't outlive the
  // session. The stored x/y are read back only by `fit`, never as a start point.
  useEffect(() => {
    let savedW: unknown;
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) savedW = (JSON.parse(raw) as Partial<Box>).w;
    } catch {
      /* corrupt entry — fall through to the default width */
    }
    const w = typeof savedW === "number" && Number.isFinite(savedW) ? savedW : defaultWidth();
    setBox(fit(bottomRight(w)));
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
  const attach = useCallback(() => {
    const el = videoRef.current;
    if (!el || !stream || el.srcObject === stream) return;
    el.srcObject = stream;
    void el.play().catch(() => {
      /* autoplay blocked: the frame stays dark, the interview is unaffected */
    });
  }, [stream]);

  const setVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      attach();
    },
    [attach],
  );

  // Attach from this side too, for whenever the stream is the one that lands
  // second. NO cleanup that stops tracks: the stream is on loan.
  useEffect(() => attach(), [attach]);

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
      {!stream ? (
        <p className="flex h-full items-center justify-center px-3 text-center text-xs text-room-muted">
          Camera unavailable
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

/**
 * Shows/hides the self view. It does NOT turn the camera off — the interview is
 * recorded either way, and a control labelled "turn the camera off" that leaves
 * the camera on is the one thing this must never be.
 */
export function CameraToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? "Hide the self view" : "Show the self view"}
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
