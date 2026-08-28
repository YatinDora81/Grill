"use client";

import { useState } from "react";

const W = 700;
const H = 200;
const L = 44;
const R = 686;
const TOP = 18;
const BASE = 168;

const GRID = [40, 60, 80];

const yOf = (score: number) => BASE - (Math.max(0, Math.min(100, score)) / 100) * (BASE - TOP);

const labelY = (y: number) => Math.max(12, y - 12);
const labelX = (x: number) => Math.max(L, Math.min(R, x));

export function Trend({ scores }: { scores: number[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const pts: [number, number][] = scores.map((s, i) => [
    L + (i * (R - L)) / (Math.max(2, scores.length) - 1),
    yOf(s),
  ]);

  if (scores.length < 2) return null;

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  const first = pts[0]!;
  const lastIndex = pts.length - 1;
  const last = pts[lastIndex]!;
  const area = `${line} L ${last[0]} ${BASE} L ${first[0]} ${BASE} Z`;

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

  const marked = hover !== null ? pts[hover]! : null;
  const active = hover !== null && hover !== lastIndex ? hover : null;
  const activePt = active !== null ? pts[active]! : null;

  const midLabel = scores.length >= 5 ? `Session ${Math.ceil(scores.length / 2)}` : null;

  return (
    <svg
      className="trend-svg"
      viewBox={`0 0 ${W} ${H}`}
      onPointerDown={onMove}
      onPointerMove={onMove}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") setHover(null);
      }}
      onPointerCancel={() => setHover(null)}
      role="img"
      aria-label={`Score trend across ${scores.length} interviews, oldest to newest: ${scores.join(", ")}`}
    >
      {GRID.map((score) => (
        <line
          key={score}
          x1={L}
          x2={R}
          y1={yOf(score)}
          y2={yOf(score)}
          strokeDasharray="3 6"
          className="stroke-(--chart-guide) [stroke-width:1]"
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

      <path d={area} className="fill-(--chart-area)" />
      <path
        d={line}
        className="trend-draw fill-none stroke-ember [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]"
        pathLength="1"
      />

      {marked ? (
        <line x1={marked[0]} x2={marked[0]} y1={TOP} y2={BASE} className="trend-guide" />
      ) : null}

      {pts.slice(0, -1).map((p, i) => (
        <circle
          key={i}
          cx={p[0]}
          cy={p[1]}
          r={hover === i ? 4 : 3.2}
          className={
            hover === i
              ? "fill-ember stroke-ember [stroke-width:1.5]"
              : "fill-(--dot-rest) stroke-ink-soft [stroke-width:1.5]"
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
