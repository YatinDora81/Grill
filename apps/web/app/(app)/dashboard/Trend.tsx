"use client";

import { useState } from "react";

/**
 * Score over time. One series, so: one hue, no legend — the card title names it.
 * The line draws itself once on load, the latest point stays lit with its number
 * showing, because that is the one that says where you stand now.
 *
 * Every other point gives up its number on hover: a guide line, a lit dot and
 * the score. Hover, not always-on labels — eight numbers stacked along a
 * 640-unit line collide, and the shape of the line is the point of the chart.
 *
 * The y-domain is pinned to the full 0–100 score range, never the data's own
 * min/max: an auto-domain would turn a 71→73 wobble into a triumphant climb.
 *
 * Straight segments, not the smoothed béziers this used to draw. A session is a
 * discrete event; a curve implies the score was somewhere in between on days you
 * didn't sit one, and the overshoot-free spline was still inventing a shape
 * between two points that has no reading.
 */
const W = 700;
const H = 200;
/** Plot box. The left gutter carries the score axis, the bottom strip the session labels. */
const L = 44;
const R = 686;
const TOP = 18;
const BASE = 168;

/**
 * Gridlines at the verdict band edges — the same 40 / 60 / 80 `scoreBand` splits
 * on — rather than at round tenths. It makes a crossing mean something: the line
 * clearing 60 is the run where the verdict stopped being "shaky".
 */
const GRID = [40, 60, 80];

const yOf = (score: number) => BASE - (Math.max(0, Math.min(100, score)) / 100) * (BASE - TOP);

/**
 * Keep a label inside the viewBox.
 *
 * Floored at 12 vertically so a perfect 100 — which sits at the top of the plot
 * — doesn't put its own ascenders outside the box and lose the top of the digits.
 */
const labelY = (y: number) => Math.max(12, y - 12);
const labelX = (x: number) => Math.max(L, Math.min(R, x));

export function Trend({ scores }: { scores: number[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const pts: [number, number][] = scores.map((s, i) => [
    L + (i * (R - L)) / (Math.max(2, scores.length) - 1),
    yOf(s),
  ]);

  // Rendered only when there are at least two points — one score is not a
  // trend. After the hooks, so the hook order never depends on the data.
  if (scores.length < 2) return null;

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  const first = pts[0]!;
  const lastIndex = pts.length - 1;
  const last = pts[lastIndex]!;
  const area = `${line} L ${last[0]} ${BASE} L ${first[0]} ${BASE} Z`;

  /**
   * Nearest point to the pointer, horizontally.
   *
   * The SVG scales to its container, so client pixels have to come back through
   * the viewBox before they mean anything: `getBoundingClientRect` gives the
   * rendered width, and W is what the coordinates below are drawn in.
   *
   * Bound to pointerdown as well as pointermove. A finger that taps without
   * travelling fires no pointermove whatsoever — move-only is why this chart
   * read as dead on a phone while working perfectly under a mouse.
   */
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i]![0] - x) < Math.abs(pts[nearest]![0] - x)) nearest = i;
    }
    setHover(nearest);
  }

  // The guide line and the lit dot follow the pointer everywhere, the latest
  // point included. Gating all three of them on one variable left the whole
  // right-hand end of the chart inert — and that is exactly where the eye goes,
  // because the brightest dot and the only standing number live there. With two
  // scores on record it was half the card giving no answer at all.
  //
  // Only the *label* still steps back at the last point: it already carries a
  // permanent one, and a second would print straight on top of it.
  const marked = hover !== null ? pts[hover]! : null;
  const active = hover !== null && hover !== lastIndex ? hover : null;
  const activePt = active !== null ? pts[active]! : null;

  // The midpoint tick is dropped below five sessions: at three or four points
  // it lands close enough to "Session 1" to read as a second label for it.
  const midLabel = scores.length >= 5 ? `Session ${Math.ceil(scores.length / 2)}` : null;

  return (
    <svg
      className="trend-svg"
      viewBox={`0 0 ${W} ${H}`}
      onPointerDown={onMove}
      onPointerMove={onMove}
      onPointerLeave={(e) => {
        // A finger fires pointerleave the moment it lifts, so honouring it on
        // touch would flash the number and snatch it away again — the tap reads
        // as a chart that ignored you. Only a pointer that can genuinely hover
        // gets to clear; a tapped read-out stands until the next tap.
        if (e.pointerType !== "touch") setHover(null);
      }}
      // `touch-action: pan-y pinch-zoom` means a vertical swipe that began on
      // the chart cancels the pointer. Without this the read-out would survive
      // a scroll and sit there pointing at nothing.
      onPointerCancel={() => setHover(null)}
      role="img"
      aria-label={`Score trend across ${scores.length} interviews, oldest to newest: ${scores.join(", ")}`}
    >
      {/* Tinted toward the series hue rather than the border grey: a `line`
          gridline over the card surface is about 1.3:1 and reads as nothing at
          all, while it still sits well under the dots and the numbers. */}
      {GRID.map((score) => (
        <line
          key={score}
          x1={L}
          x2={R}
          y1={yOf(score)}
          y2={yOf(score)}
          strokeDasharray="3 6"
          className="stroke-ember/25 [stroke-width:1]"
        />
      ))}
      {GRID.map((score) => (
        <text
          key={score}
          x={L - 12}
          y={yOf(score) + 3.5}
          textAnchor="end"
          className="fill-ink-muted font-mono text-[9px] tracking-[0.08em]"
        >
          {score}
        </text>
      ))}

      <path d={area} className="fill-ember/10" />
      {/* pathLength="1" so one dash covers the line whatever its real length. */}
      <path
        d={line}
        className="trend-draw fill-none stroke-ember [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]"
        pathLength="1"
      />

      {marked ? (
        <line x1={marked[0]} x2={marked[0]} y1={TOP} y2={BASE} className="trend-guide" />
      ) : null}

      {/* `slice(0, -1)` already excludes the latest point, so keying these off
          `hover` rather than `active` cannot double-draw it — the index simply
          never matches. */}
      {pts.slice(0, -1).map((p, i) => (
        <circle
          key={i}
          cx={p[0]}
          cy={p[1]}
          r={hover === i ? 4 : 3.2}
          className={
            hover === i
              ? "fill-ember stroke-ember [stroke-width:1.5]"
              : "fill-paper stroke-ink-soft [stroke-width:1.5]"
          }
        />
      ))}

      <circle cx={last[0]} cy={last[1]} r="4.2" className="fill-ember stroke-ember" />
      <text
        x={last[0] - 8}
        y={labelY(last[1])}
        textAnchor="end"
        className="fill-ember font-mono text-[10px] font-semibold"
      >
        {scores[lastIndex]}
      </text>

      {activePt ? (
        <text
          x={labelX(activePt[0])}
          y={labelY(activePt[1])}
          textAnchor="middle"
          className="fill-ember font-mono text-[10px] font-semibold"
        >
          {scores[active!]}
        </text>
      ) : null}

      {/* The x axis is named in words, not in dates: "session 7" is how someone
          counts their own practice, and the row below the chart already carries
          the calendar. */}
      <text x={L} y={H - 10} className="fill-ink-muted font-mono text-[9px] tracking-[0.08em]">
        Session 1
      </text>
      {midLabel ? (
        <text
          x={(L + R) / 2}
          y={H - 10}
          textAnchor="middle"
          className="fill-ink-muted font-mono text-[9px] tracking-[0.08em]"
        >
          {midLabel}
        </text>
      ) : null}
      <text
        x={R}
        y={H - 10}
        textAnchor="end"
        className="fill-ink-muted font-mono text-[9px] tracking-[0.08em]"
      >
        Latest
      </text>
    </svg>
  );
}
