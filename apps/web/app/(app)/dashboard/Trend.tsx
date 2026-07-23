"use client";

import { useState } from "react";

/**
 * Score over time. One series, so: one hue, no legend — the card title names it.
 * The line draws itself once on load, the area fades in behind it, and the
 * latest point stays lit with its number showing, because that is the one that
 * says where you stand now.
 *
 * Every other point gives up its number on hover: a guide line, a lit dot and
 * the score. Hover, not always-on labels — eight numbers stacked along a
 * 560-unit line collide, and the shape of the line is the point of the chart.
 *
 * The y-domain is pinned to the full 0–100 score range, never the data's own
 * min/max: an auto-domain would turn a 71→73 wobble into a triumphant climb.
 */
const W = 560;
const H = 140;
const PAD_X = 14;
const TOP = 18;
const BOTTOM = 120;

/** Smooth line through the points — midpoint cubic béziers, no overshoot. */
function smoothPath(pts: [number, number][]): string {
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const mx = (x0 + x1) / 2;
    d += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
  }
  return d;
}

/**
 * Keep a label inside the viewBox.
 *
 * Floored at 12 vertically so a perfect 100 — which sits at y=18 — doesn't put
 * its own ascenders outside the box and lose the top of the digits.
 */
const labelY = (y: number) => Math.max(12, y - 12);
const labelX = (x: number) => Math.max(16, Math.min(W - 16, x));

export function Trend({ scores }: { scores: number[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const pts: [number, number][] = scores.map((s, i) => [
    PAD_X + (i * (W - PAD_X * 2)) / (Math.max(2, scores.length) - 1),
    BOTTOM - (clamp(s) / 100) * (BOTTOM - TOP),
  ]);

  // Rendered only when there are at least two points — one score is not a
  // trend. After the hooks, so the hook order never depends on the data.
  if (scores.length < 2) return null;

  const line = smoothPath(pts);
  const first = pts[0]!;
  const lastIndex = pts.length - 1;
  const last = pts[lastIndex]!;
  const area = `${line} L ${last[0]} ${H - 6} L ${first[0]} ${H - 6} Z`;

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
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" className="g-stop-ember" />
          <stop offset="70%" className="g-stop-hot" />
          <stop offset="100%" className="g-stop-glow" />
        </linearGradient>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="g-stop-ember-22" />
          <stop offset="100%" className="g-stop-ember-0" />
        </linearGradient>
      </defs>

      <path d={area} className="trend-area" />
      {/* pathLength="1" so one dash covers the line whatever its real length. */}
      <path d={line} className="trend-line trend-draw" pathLength="1" />

      {marked ? (
        <line x1={marked[0]} x2={marked[0]} y1={TOP - 6} y2={BOTTOM} className="trend-guide" />
      ) : null}

      {/* `slice(0, -1)` already excludes the latest point, so keying these off
          `hover` rather than `active` cannot double-draw it — the index simply
          never matches. */}
      {pts.slice(0, -1).map((p, i) => (
        <circle
          key={i}
          cx={p[0]}
          cy={p[1]}
          r={hover === i ? 3.4 : 2.6}
          className={hover === i ? "trend-dot-hover" : "trend-dot"}
        />
      ))}

      <circle cx={last[0]} cy={last[1]} r="3.4" className="trend-dot-last" />
      <text x={last[0] - 6} y={labelY(last[1])} textAnchor="end" className="trend-val">
        {scores[lastIndex]}
      </text>

      {activePt ? (
        <text
          x={labelX(activePt[0])}
          y={labelY(activePt[1])}
          textAnchor="middle"
          className="trend-val"
        >
          {scores[active!]}
        </text>
      ) : null}
    </svg>
  );
}
