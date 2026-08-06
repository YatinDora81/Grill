"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

const ASPECT = 4 / 3;
const MIN_W = 140;
const MAX_W = 520;
const MARGIN = 16;
/**
 * The bottom inset, which is NOT the plain margin.
 *
 * MARGIN * 4, not MARGIN: the bottom strip is where the record button lives,
 * and this is `fixed z-50` with pointer handlers — flush to the edge it would
 * sit on top of the control and eat the tap.
 *
 * Lifted to a constant so the opening corner and the snap-to-corner can never
 * drift apart: anything that parks the box against the bottom has to use this.
 */
const BOTTOM_MARGIN = MARGIN * 4;
const POS_KEY = "grill.selfview";

/** The title bar's height — and the box's whole height once minimised. */
const BAR_H = 28;

/** Keyboard nudge, the same with Shift held, and the +/- resize step. */
const NUDGE = 12;
const NUDGE_FAST = 40;
const KEY_STEP = 32;

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

/**
 * The size presets, in the same viewport fractions — corner-dragging is
 * undiscoverable, so most people never resize at all. Every one of these routes
 * through `fit`, so the clamp stays the single source of truth for how big the
 * box is allowed to get.
 */
const PRESETS = { s: 0.2, m: 0.3, l: 0.45 } as const;
type PresetKey = keyof typeof PRESETS;
const PRESET_LABEL: Record<PresetKey, string> = { s: "Small", m: "Medium", l: "Large" };

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

/**
 * How tall the shell actually is.
 *
 * Everything that parks the box measures it from the bottom edge up, so it has
 * to be the REAL height: a minimised shell is cropped to its bar, and measuring
 * it as a full frame left it floating the frame's height clear of wherever it
 * was aimed. BOTTOM_MARGIN is unchanged either way — the clearance kept above
 * the record button is the same for both states.
 */
function shellH(w: number, minimised: boolean): number {
  return minimised ? BAR_H : w / ASPECT;
}

/** The corner every interview opens in. */
function bottomRight(w: number, minimised: boolean): Box {
  return {
    w,
    x: window.innerWidth - w - MARGIN,
    y: window.innerHeight - shellH(w, minimised) - BOTTOM_MARGIN,
  };
}

/** Keep the box on screen — a window resize must never strand it off-viewport. */
function fit(b: Box, minimised: boolean): Box {
  // On a phone even MIN_W is a third of the screen, so the floor has to give.
  const minW = Math.min(MIN_W, window.innerWidth * MIN_W_VW);
  // MAX_W is the FLOOR of the ceiling, not the ceiling. A flat 520 cap swallowed
  // the top presets on a wide monitor — M (0.3) hits it at 1734px and L (0.45) at
  // 1156px, so above 1734px the two produced identical geometry and one of the
  // three buttons did nothing but move the highlight. Letting the ceiling grow
  // with the largest preset keeps all three distinct at every width.
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

/**
 * The width a preset actually lands on, after `fit`'s clamps have had their say.
 *
 * Which S/M/L button reads as pressed is DERIVED from this rather than stored.
 * A remembered `preset` is a second source of truth that goes stale the moment
 * anything else changes the width — a corner-drag, a keyboard `+`, or simply
 * reopening the room on a different-sized window, where the restored pixel width
 * no longer corresponds to the fraction that produced it. Comparing against the
 * real width can't drift.
 */
function presetWidth(k: PresetKey, minimised: boolean): number {
  return fit({ x: 0, y: 0, w: Math.round(window.innerWidth * PRESETS[k]) }, minimised).w;
}

/**
 * Keep the box clear of the control strip after its HEIGHT changes.
 *
 * `fit`'s job is only to stop the box leaving the viewport, so its bottom bound
 * is the plain MARGIN — and that is right for a DRAG, where the user deliberately
 * chose where to put the box and must be allowed to park it low.
 *
 * Growing is different. It anchors the top edge, so the extra height goes
 * straight down into the strip `fit` is happy to let it fill: on a 1440x900
 * window, one click of the "L" preset takes the box from 76px clear of the floor
 * to 16px, directly over `.room-foot` and the record button. Since this shell is
 * `fixed z-50 touch-none` with pointer handlers, it eats the tap and the
 * candidate cannot start recording — the exact failure BOTTOM_MARGIN exists to
 * prevent, reintroduced by the S/M/L presets and the keyboard `+`.
 *
 * `Math.min`, never a clamp upward: a box the user dragged to the TOP of the
 * screen must not be yanked down to meet a bottom margin it was nowhere near.
 */
function fitGrown(b: Box, minimised: boolean): Box {
  const next = fit(b, minimised);
  const h = shellH(next.w, minimised);
  return { ...next, y: Math.min(next.y, Math.max(MARGIN, window.innerHeight - h - BOTTOM_MARGIN)) };
}

/**
 * Park the box in whichever corner it is already closest to.
 *
 * The bottom two corners use BOTTOM_MARGIN, not `fit`'s bottom bound: `fit`
 * only stops the box leaving the viewport, and a box legally inside the
 * viewport can still be sitting on the record button. Running the result
 * through `fit` afterwards is safe because this is a pure MOVE — the height
 * doesn't change, so `fit`'s looser bottom bound is below the one this already
 * chose and never pulls the box back over the control. That reasoning does not
 * extend to anything that resizes; see `fitGrown`.
 */
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

/**
 * Square, and outlined a step brighter than the bar inside it — the whole
 * redesign is hard-edged, and this box floats over a dark room with nothing but
 * its own edge to separate it from the question underneath.
 */
const SHELL =
  "group fixed z-50 cursor-grab touch-none overflow-hidden border border-line-strong bg-room-raised shadow-[0_22px_60px_-20px_rgba(0,0,0,0.9)] active:cursor-grabbing";

/** The title bar doubles as the drag handle, so it keeps the grab cursor. */
const BAR =
  "absolute inset-x-0 top-0 z-10 flex h-7 items-center gap-2 border-b border-room-line bg-room pr-8 pl-2 font-mono text-[9px] tracking-[0.16em] text-room-muted uppercase";

/**
 * Pressed reads as INK-ON-PAPER, not as a tint. At 22×20px a 10%-opacity fill
 * is invisible against the bar, and which of S/M/L is active was the one thing
 * these buttons exist to tell you.
 */
const PIP_BTN =
  "flex h-5 w-[22px] items-center justify-center border border-room-line text-[9px] leading-none text-room-muted transition-colors hover:border-line-strong hover:text-room-ink aria-pressed:border-room-ink aria-pressed:bg-room-ink aria-pressed:font-semibold aria-pressed:text-room";

/** The overlay chips — same hairline box as everything else in the room. */
const PIP_CHIP =
  "absolute z-20 inline-flex items-center gap-1.5 border border-room-line bg-room/75 px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.14em] uppercase";

/**
 * Zoom-style self view: a mirrored picture-in-picture you can drag anywhere,
 * resize from the corner or the S/M/L presets, minimise to its title bar, and
 * move with the keyboard.
 *
 * A pure VIEW of a stream it does not own. It used to call getUserMedia itself
 * and stop the tracks on unmount — which was fine when the camera existed only
 * to be looked at, and became a bug the moment the session was being recorded:
 * closing the PiP would have silently ended the recording. The stream (and its
 * lifetime) belong to useSessionVideo now; this just paints it.
 */
export function SelfView({
  stream,
  onClose,
  micOn,
  level,
  recording,
}: {
  stream: MediaStream | null;
  onClose: () => void;
  /** Whether the recorder is live. The mic is not on this stream. */
  micOn: boolean;
  /** 0–1, straight off the recorder's analyser. Meaningless unless `micOn`. */
  level: number;
  /** Whether the SESSION video is being recorded — not whether a take is. */
  recording: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [minimised, setMinimised] = useState(false);

  // Position lives in state, not CSS, because dragging has to write it back.
  // Initialised on mount: the corner needs window dimensions, which don't exist
  // during SSR — and so does anything read out of localStorage, which is why
  // the stored size lands here rather than in a lazy initial state.
  //
  // SIZE is restored from the last session; POSITION deliberately is not. Every
  // interview opens in the bottom-right, because where the box was dragged to
  // during some earlier interview says nothing about where it should sit in
  // this one — that room had a different question on screen, possibly at a
  // different window size. Dragging still works; it just doesn't outlive the
  // session. The stored x/y are read back only by `fit`, never as a start point.
  useEffect(() => {
    let w = defaultWidth();
    let storedMinimised = false;
    // Every READ of the parsed entry stays inside the try, not just the parse:
    // `JSON.parse("null")` hands back a null that the cast happily calls an
    // object, and reading a field off it throws — from an effect, which takes
    // the whole room down. Anything that throws in here is a corrupt entry.
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? "{}") as Partial<
        Record<"w" | "minimised", unknown>
      >;
      if (typeof saved.w === "number" && Number.isFinite(saved.w)) w = saved.w;
      storedMinimised = saved.minimised === true;
    } catch {
      /* corrupt entry — fall through to the defaults */
    }
    setMinimised(storedMinimised);
    setBox(fitGrown(bottomRight(w, storedMinimised), storedMinimised));
  }, []);

  useEffect(() => {
    // `fitGrown`, not `fit`: shrinking the viewport lowers the bottom bound and
    // would re-park the box 16px off the floor — on top of the record button,
    // which is the exact failure BOTTOM_MARGIN exists to prevent. A resize
    // changes the geometry just as much as a preset does.
    const onResize = () => setBox((b) => (b ? fitGrown(b, minimised) : b));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minimised]);

  // Extra keys on the same entry rather than a second one: the read path only
  // ever picks fields off it, so an older stored `{x,y,w}` still loads.
  useEffect(() => {
    if (!box) return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ ...box, minimised }));
    } catch {
      /* private mode: position just won't persist */
    }
  }, [box, minimised]);

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
        // Drag left to grow: the grip owns the bottom-left corner, so pulling
        // away from it reading as "bigger" is what people expect. The edge
        // opposite the grip is anchored to where it was on pointer-down, so the
        // grip tracks the pointer from wherever the box has been parked.
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
    // Fitted as expanded, because that is what it is about to be — a preset
    // restores the frame.
    setBox((b) =>
      b ? fitGrown({ ...b, w: Math.round(window.innerWidth * PRESETS[k]) }, false) : b,
    );
  }, []);

  /** Re-fit on the way through: the shell's height changes, so its bounds do. */
  const toggleMinimised = useCallback((next: boolean) => {
    setMinimised(next);
    setBox((b) => (b ? fitGrown(b, next) : b));
  }, []);

  /**
   * Arrows move, +/- resize. Without this the box is pointer-only, which puts
   * it out of reach for keyboard and switch users entirely.
   */
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
      // Swallowed only now that we know we're handling it, so Tab, Escape and
      // everything else still reach the page.
      e.preventDefault();
      const next = move;
      // Only the +/- branch changes height, so only it needs the stricter bottom
      // bound — arrow keys stay on `fit` so they can still park the box anywhere
      // the user points them.
      setBox((b) => (b ? (resized ? fitGrown(next(b), minimised) : fit(next(b), minimised)) : b));
    },
    [minimised],
  );

  if (!box) return null;

  const frameH = box.w / ASPECT;

  /**
   * Which S/M/L reads as pressed, worked out from the width the box is actually
   * at. Below the `!box` guard so `window` is only touched on the client.
   *
   * `find`, so the first match wins: if two presets ever clamp to the same width
   * the highlight lands on one of them rather than on both.
   */
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
      // Through the same helper the bounds use, so what is painted and what is
      // clamped can never disagree about how tall this is.
      style={{ left: box.x, top: box.y, width: box.w, height: shellH(box.w, minimised) }}
      className={SHELL}
    >
      {/* The title bar sits OVER the frame rather than above it: the box's
          height is the aspect-locked frame, and every bound in `fit` is
          computed from that. A bar that added its own height would put the
          real bottom edge lower than the clamp thinks it is — which is the
          record button again. Minimising just crops the shell to the bar. */}
      <div
        className={BAR}
        onDoubleClick={() => setBox((b) => (b ? fit(snapToCorner(b, minimised), minimised) : b))}
      >
        {/* Six dots — the universal "this edge is a handle". The bar was already
            draggable and read as a plain caption, so nobody tried. */}
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
              // The visible letter leads the accessible name: without it in
              // there, a voice-control user saying "click S" matches nothing
              // (WCAG 2.5.3).
              aria-label={`${k.toUpperCase()}, ${PRESET_LABEL[k]} camera`}
              // The bar is the drag handle: without this, mousedown on a button
              // starts a drag and the click never lands.
              onPointerDown={(e) => e.stopPropagation()}
              // And dblclick bubbles too — the bar snaps to a corner on it, so
              // without this a double-tapped preset also teleports the box.
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={() => applyPreset(k)}
              className={PIP_BTN}
            >
              {k.toUpperCase()}
            </button>
          ))}
          {/* "Minimise", never "off": the camera keeps running and the
              interview keeps recording either way. */}
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
          // Height is the frame's, not the shell's, so minimising crops the
          // picture instead of squashing it — and never unmounts the element,
          // which would drop `srcObject` and leave the restored view black.
          style={{ height: frameH }}
          // Mirrored: you expect your own reflection, not a stranger's view.
          className="w-full -scale-x-100 object-cover"
        />
      )}

      {/* Both chips sit on the right edge rather than diagonally opposite, the
          way the reference has them: the resize grip owns the bottom-LEFT
          corner here (the box lives bottom-right, so you pull away from the
          corner to grow it), and a chip parked on top of it would swallow the
          drag.

          Both are gone while minimised, and that is a correctness fix rather
          than a tidy-up: these are positioned against the SHELL, which is
          cropped to the 28px bar in that state, so `bottom` would land the mic
          chip on top of the title bar and over the S/M/L buttons. */}
      {!minimised && recording && (
        <span
          className={cx(PIP_CHIP, "top-[34px] right-1.5 border-ember/40 text-ember")}
          title="This interview is being recorded"
        >
          <i aria-hidden="true" className="size-[6px] flex-none bg-ember animate-pulse-rec" />
          Rec
        </span>
      )}

      {/* The mic level, and the only thing on this screen that says the words
          you are speaking are landing anywhere — the live transcript that used
          to say it is gone on purpose. Green, because ember is spoken for by
          "recording" one chip above this one. */}
      {!minimised && (
        <span className={cx(PIP_CHIP, "bottom-1.5 right-1.5 text-room-muted")}>
          <MicLevel on={micOn} level={level} />
          {micOn ? "Mic on" : "Mic off"}
        </span>
      )}

      {/* "Hide", not "turn off": this only unmounts the preview. The stream and
          the recorder belong to useSessionVideo and keep running — the capture
          light stays lit and the interview is still being recorded. */}
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

      {/* Resize grip. `data-handle` is what the pointer-down reads to tell a
          resize from a drag. Gone while minimised — there is no frame to pull. */}
      {!minimised && (
        // Diagonal hatch rather than a dot: it is the corner-grip idiom every
        // resizable window uses, so it reads as "pull me" without a label. The
        // bands are drawn from `currentColor`, which is what lets the whole
        // grip go ember on hover from a text-colour utility alone. 45deg, not
        // the reference's 135deg — this grip is on the bottom-LEFT corner, so
        // the hatch is mirrored to run with that corner's edge.
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

/** Five bars, and the fall-off that makes the middle one react most. */
const MIC_BARS = 5;

/**
 * The mic meter in the corner of the self view.
 *
 * Driven by the recorder's real analyser output, never by a timer: `animate-eq`
 * is in the token set and would look identical, but a shimmer that runs while
 * the mic is shut tells the candidate they are being heard when no stream is
 * open — the exact lie this screen exists to avoid now that the live transcript
 * is gone. Flat bars when it's off, moving bars when it isn't.
 */
function MicLevel({ on, level }: { on: boolean; level: number }) {
  return (
    <span aria-hidden="true" className="inline-flex h-[11px] flex-none items-end gap-[2px]">
      {Array.from({ length: MIC_BARS }).map((_, i) => {
        const falloff = 1 - Math.abs(i - (MIC_BARS - 1) / 2) / MIC_BARS;
        // A floor, not a zero: five invisible bars is indistinguishable from a
        // broken widget, and silence between words is not a fault.
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
