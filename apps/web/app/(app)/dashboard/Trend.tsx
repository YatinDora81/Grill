"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Score-over-time sparkline. One series, so: one hue, no legend (the card title
 * names it). The line is ink — ember is reserved for heat — and only the latest
 * point is ember, marking where you stand now.
 *
 * The y-domain is pinned to the full 0–100 score range, never the data's own
 * min/max: an auto-domain would turn a 71→73 wobble into a triumphant climb.
 */
const PAD = { top: 10, right: 14, bottom: 10, left: 14 };
const HEIGHT = 116;

export function Trend({ scores }: { scores: number[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  // Measure rather than rely on preserveAspectRatio: non-uniform scaling would
  // turn the end-dot into an ellipse and make hover hit-testing lie.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (scores.length === 1 ? innerW / 2 : (i / (scores.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;

  const pts = scores.map((s, i) => ({ x: x(i), y: y(s), v: s, i }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area =
    pts.length > 0
      ? `${line} L${pts[pts.length - 1]!.x},${PAD.top + innerH} L${pts[0]!.x},${PAD.top + innerH} Z`
      : "";

  const last = pts[pts.length - 1];
  const active = hover !== null ? pts[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!innerW || pts.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let nearest = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i]!.x - px) < Math.abs(pts[nearest]!.x - px)) nearest = i;
    }
    setHover(nearest);
  }

  return (
    <div ref={wrapRef} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          // `touch-none` here meant a vertical swipe that happened to start on
          // the chart scrolled nothing — the dashboard just stuck. Only the
          // horizontal axis carries the hover readout, so give the browser back
          // vertical panning and pinch-zoom and keep the rest.
          className="touch-pan-y touch-pinch-zoom select-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Score trend across ${scores.length} interviews, oldest to newest: ${scores.join(", ")}`}
        >
          {/* Recessive reference lines at 0/50/100 — hairline, solid. */}
          {[0, 50, 100].map((v) => (
            <line
              key={v}
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
          ))}

          <path d={area} fill="var(--color-ink-soft)" opacity={0.08} />
          <path
            d={line}
            fill="none"
            stroke="var(--color-ink-soft)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {active && (
            <line
              x1={active.x}
              x2={active.x}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="var(--color-line-strong)"
              strokeWidth={1}
            />
          )}

          {/* Latest point: emphasis, with a 2px surface ring so it stays legible. */}
          {last && (
            <circle
              cx={last.x}
              cy={last.y}
              r={4.5}
              fill="var(--color-ember)"
              stroke="var(--color-paper-raised)"
              strokeWidth={2}
            />
          )}
          {active && active.i !== last?.i && (
            <circle
              cx={active.x}
              cy={active.y}
              r={4.5}
              fill="var(--color-ink-soft)"
              stroke="var(--color-paper-raised)"
              strokeWidth={2}
            />
          )}
        </svg>
      )}

      {active && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-paper-raised px-2.5 py-1.5 shadow-sm"
          style={{ left: active.x, top: active.y - 10 }}
        >
          <p className="tabular font-mono text-sm font-semibold">{active.v}</p>
          <p className="text-[11px] whitespace-nowrap text-ink-muted">
            {active.i === scores.length - 1 ? "Latest" : `#${active.i + 1}`}
          </p>
        </div>
      )}
    </div>
  );
}
