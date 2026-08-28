"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

const ASPECT = 4 / 3;
const MIN_W = 140;
const MAX_W = 520;
const MARGIN = 16;
const BOTTOM_MARGIN = MARGIN * 4;
const POS_KEY = "grill.selfview";

const BAR_H = 28;

const NUDGE = 12;
const NUDGE_FAST = 40;
const KEY_STEP = 32;

const DEFAULT_W = 240;
const DEFAULT_W_VW = 0.3;
const MIN_W_VW = 0.25;

const PRESETS = { s: 0.2, m: 0.3, l: 0.45 } as const;
type PresetKey = keyof typeof PRESETS;
const PRESET_LABEL: Record<PresetKey, string> = { s: "Small", m: "Medium", l: "Large" };

interface Box {
  x: number;
  y: number;
  w: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function defaultWidth(): number {
  return Math.min(DEFAULT_W, Math.round(window.innerWidth * DEFAULT_W_VW));
}

function shellH(w: number, minimised: boolean): number {
  return minimised ? BAR_H : w / ASPECT;
}

function bottomRight(w: number, minimised: boolean): Box {
  return {
    w,
    x: window.innerWidth - w - MARGIN,
    y: window.innerHeight - shellH(w, minimised) - BOTTOM_MARGIN,
  };
}

function fit(b: Box, minimised: boolean): Box {
  const minW = Math.min(MIN_W, window.innerWidth * MIN_W_VW);
  const maxW = Math.min(
    window.innerWidth - MARGIN * 2,
    Math.max(MAX_W, Math.round(window.innerWidth * PRESETS.l)),
  );
  const w = clamp(b.w, minW, maxW);
  const h = shellH(w, minimised);
  return {
    w,
    x: clamp(b.x, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN)),
    y: clamp(b.y, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN)),
  };
}

function presetWidth(k: PresetKey, minimised: boolean): number {
  return fit({ x: 0, y: 0, w: Math.round(window.innerWidth * PRESETS[k]) }, minimised).w;
}

function fitGrown(b: Box, minimised: boolean): Box {
  const next = fit(b, minimised);
  const h = shellH(next.w, minimised);
  return { ...next, y: Math.min(next.y, Math.max(MARGIN, window.innerHeight - h - BOTTOM_MARGIN)) };
}

function snapToCorner(b: Box, minimised: boolean): Box {
  const h = shellH(b.w, minimised);
  const left = b.x + b.w / 2 < window.innerWidth / 2;
  const top = b.y + h / 2 < window.innerHeight / 2;
  return {
    w: b.w,
    x: left ? MARGIN : window.innerWidth - b.w - MARGIN,
    y: top ? MARGIN : window.innerHeight - h - BOTTOM_MARGIN,
  };
}

const SHELL =
  "group fixed z-50 cursor-grab touch-none overflow-hidden border border-line-strong bg-room-raised shadow-(--shadow-float) active:cursor-grabbing";

const BAR =
  "absolute inset-x-0 top-0 z-10 flex h-7 items-center gap-2 border-b border-room-line bg-room pr-8 pl-2 font-mono text-[9px] tracking-[0.16em] text-room-muted uppercase";

const PIP_BTN =
  "flex h-5 w-[22px] items-center justify-center border border-room-line text-[9px] leading-none text-room-muted transition-colors hover:border-line-strong hover:text-room-ink aria-pressed:border-room-ink aria-pressed:bg-room-ink aria-pressed:font-semibold aria-pressed:text-room";

const PIP_CHIP =
  "absolute z-20 inline-flex items-center gap-1.5 border border-room-line bg-room/75 px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.14em] uppercase";

export function SelfView({
  stream,
  onClose,
  micOn,
  level,
  recording,
}: {
  stream: MediaStream | null;
  onClose: () => void;
  micOn: boolean;
  level: number;
  recording: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [minimised, setMinimised] = useState(false);

  useEffect(() => {
    let w = defaultWidth();
    let storedMinimised = false;
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? "{}") as Partial<
        Record<"w" | "minimised", unknown>
      >;
      if (typeof saved.w === "number" && Number.isFinite(saved.w)) w = saved.w;
      storedMinimised = saved.minimised === true;
    } catch {}
    setMinimised(storedMinimised);
    setBox(fitGrown(bottomRight(w, storedMinimised), storedMinimised));
  }, []);

  useEffect(() => {
    const onResize = () => setBox((b) => (b ? fitGrown(b, minimised) : b));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minimised]);

  useEffect(() => {
    if (!box) return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ ...box, minimised }));
    } catch {}
  }, [box, minimised]);

  const attach = useCallback(() => {
    const el = videoRef.current;
    if (!el || !stream || el.srcObject === stream) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
  }, [stream]);

  const setVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      attach();
    },
    [attach],
  );

  useEffect(() => attach(), [attach]);

  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resize = useRef<{ x0: number; w0: number; right0: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!box) return;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      if ((e.target as HTMLElement).dataset.handle === "resize") {
        resize.current = { x0: e.clientX, w0: box.w, right0: box.x + box.w };
      } else {
        drag.current = { dx: e.clientX - box.x, dy: e.clientY - box.y };
      }
    },
    [box],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (drag.current) {
        const { dx, dy } = drag.current;
        setBox((b) => (b ? fit({ ...b, x: e.clientX - dx, y: e.clientY - dy }, minimised) : b));
      } else if (resize.current) {
        const { x0, w0, right0 } = resize.current;
        setBox((b) => {
          if (!b) return b;
          const sized = fit({ ...b, w: w0 + (x0 - e.clientX) }, minimised);
          return fitGrown({ ...sized, x: right0 - sized.w }, minimised);
        });
      }
    },
    [minimised],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    resize.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const applyPreset = useCallback((k: PresetKey) => {
    setMinimised(false);
    setBox((b) =>
      b ? fitGrown({ ...b, w: Math.round(window.innerWidth * PRESETS[k]) }, false) : b,
    );
  }, []);

  const toggleMinimised = useCallback((next: boolean) => {
    setMinimised(next);
    setBox((b) => (b ? fitGrown(b, next) : b));
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? NUDGE_FAST : NUDGE;
      let move: ((b: Box) => Box) | null = null;
      let resized = false;
      switch (e.key) {
        case "ArrowLeft":
          move = (b) => ({ ...b, x: b.x - step });
          break;
        case "ArrowRight":
          move = (b) => ({ ...b, x: b.x + step });
          break;
        case "ArrowUp":
          move = (b) => ({ ...b, y: b.y - step });
          break;
        case "ArrowDown":
          move = (b) => ({ ...b, y: b.y + step });
          break;
        case "+":
        case "=":
          move = (b) => ({ ...b, w: b.w + KEY_STEP });
          resized = true;
          break;
        case "-":
        case "_":
          move = (b) => ({ ...b, w: b.w - KEY_STEP });
          resized = true;
          break;
        default:
          return;
      }
      e.preventDefault();
      const next = move;
      setBox((b) => (b ? (resized ? fitGrown(next(b), minimised) : fit(next(b), minimised)) : b));
    },
    [minimised],
  );

  if (!box) return null;

  const frameH = box.w / ASPECT;

  const activePreset =
    (Object.keys(PRESETS) as PresetKey[]).find((k) => presetWidth(k, minimised) === box.w) ?? null;

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label="Self view camera. Arrow keys move it, plus and minus resize it."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      style={{ left: box.x, top: box.y, width: box.w, height: shellH(box.w, minimised) }}
      className={SHELL}
    >
      <div
        className={BAR}
        onDoubleClick={() => setBox((b) => (b ? fit(snapToCorner(b, minimised), minimised) : b))}
      >
        <span aria-hidden="true" className="grid flex-none grid-cols-2 gap-[2px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <i key={i} className="block size-[2px] bg-room-muted" />
          ))}
        </span>
        <span aria-hidden="true">You</span>
        <span className="ml-auto flex items-center gap-[3px]">
          {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={activePreset === k}
              aria-label={`${k.toUpperCase()}, ${PRESET_LABEL[k]} camera`}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={() => applyPreset(k)}
              className={PIP_BTN}
            >
              {k.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={minimised}
            aria-label={minimised ? "Expand the self view" : "Minimise the self view"}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={() => toggleMinimised(!minimised)}
            className={PIP_BTN}
          >
            {minimised ? "+" : "–"}
          </button>
        </span>
      </div>

      {!stream ? (
        <p
          style={{ height: frameH }}
          className="flex items-center justify-center px-3 text-center text-xs text-room-muted"
        >
          Camera unavailable
        </p>
      ) : (
        <video
          ref={setVideo}
          autoPlay
          muted
          playsInline
          style={{ height: frameH }}
          className="w-full -scale-x-100 object-cover"
        />
      )}

      {!minimised && recording && (
        <span
          className={cx(PIP_CHIP, "top-[34px] right-1.5 border-ember/40 text-ember")}
          title="This interview is being recorded"
        >
          <i aria-hidden="true" className="size-[6px] flex-none bg-ember animate-pulse-rec" />
          Rec
        </span>
      )}

      {!minimised && (
        <span className={cx(PIP_CHIP, "bottom-1.5 right-1.5 text-room-muted")}>
          <MicLevel on={micOn} level={level} />
          {micOn ? "Mic on" : "Mic off"}
        </span>
      )}

      <button
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Hide the self view"
        className="absolute top-1 right-1.5 z-30 flex size-5 items-center justify-center border border-room-line bg-room/80 text-room-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M5 5l14 14M19 5L5 19"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {!minimised && (
        <span
          data-handle="resize"
          aria-hidden
          style={{
            backgroundImage:
              "linear-gradient(45deg, transparent 52%, currentColor 52% 60%, transparent 60% 70%, currentColor 70% 78%, transparent 78%)",
          }}
          className="absolute bottom-0 left-0 z-30 size-[22px] cursor-nesw-resize text-room-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-ember"
        />
      )}
    </div>
  );
}

const MIC_BARS = 5;

function MicLevel({ on, level }: { on: boolean; level: number }) {
  return (
    <span aria-hidden="true" className="inline-flex h-[11px] flex-none items-end gap-[2px]">
      {Array.from({ length: MIC_BARS }).map((_, i) => {
        const falloff = 1 - Math.abs(i - (MIC_BARS - 1) / 2) / MIC_BARS;
        const pct = on ? Math.max(18, Math.min(100, level * 130 * falloff)) : 18;
        return (
          <i
            key={i}
            style={{ height: `${pct}%` }}
            className={cx("block w-[3px]", on ? "bg-strong" : "bg-room-line")}
          />
        );
      })}
    </span>
  );
}

export function CameraToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? "Hide the self view" : "Show the self view"}
      className={cx(
        "flex size-8 shrink-0 items-center justify-center transition-colors hover:bg-room-raised",
        on ? "text-room-ink" : "text-room-muted",
      )}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="2" y="6" width="13" height="12" rx="2.5" stroke="currentColor" strokeWidth="2" />
        <path
          d="m15 11 6-3.5v9L15 13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {!on && <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      </svg>
    </button>
  );
}
