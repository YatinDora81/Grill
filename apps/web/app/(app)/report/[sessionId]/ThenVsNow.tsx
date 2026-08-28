"use client";

import { useState } from "react";
import Link from "next/link";
import type { Comparison, DiffOp, MetricDelta, TurnComparison } from "@repo/types";
import { cx } from "@/components/ui";
import { Explain } from "@/components/Explain";

function fmt(value: number | null, unit: string): string {
  if (value === null) return "—";
  return `${value}${unit}`;
}

function fmtDelta(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (value === 0) return `±0${unit}`;
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}${unit}`;
}

function deltaTone(d: MetricDelta): string {
  if (d.delta === null || d.delta === 0 || d.better === "none") return "text-ink-muted";
  const improved = d.better === "up" ? d.delta > 0 : d.delta < 0;
  return improved ? "tone-strong" : "tone-weak";
}

function arrow(delta: number | null): string {
  if (delta === null) return "";
  if (delta > 0) return "▲";
  if (delta < 0) return "▼";
  return "±";
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ThenVsNow({ comparison }: { comparison: Comparison }) {
  const [showChanges, setShowChanges] = useState(true);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href={`/report/${comparison.parent_session_id}`} className="vs-label">
          Then · {comparison.parent_name?.trim() || "earlier run"} · {stamp(comparison.parent_date)}
        </Link>
        <span aria-hidden="true" className="font-mono text-[0.7rem] text-ink-muted">
          →
        </span>
        <span className="label">Now</span>
      </div>

      <ScoreRow overall={comparison.overall} categories={comparison.categories} />

      <DeliveryTable deltas={comparison.delivery} />

      {comparison.turns.length > 0 ? (
        <>
          <div className="mt-9 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2 border-b border-line pb-2.5">
            <h3 className="font-mono text-[0.62rem] tracking-[0.16em] uppercase text-ink-muted">
              The same questions, twice
            </h3>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              aria-pressed={showChanges}
              onClick={() => setShowChanges((v) => !v)}
            >
              {showChanges ? "Show both" : "Show changes"}
            </button>
          </div>
          {comparison.turns.map((t) => (
            <TurnPair key={t.turn_index} turn={t} showChanges={showChanges} />
          ))}
        </>
      ) : (
        <p className="mono-note mt-8">
          Neither run has two answers to the same question, so there is nothing to lay side by side.
        </p>
      )}
    </div>
  );
}

export function RetryForward({
  count,
  latestId,
  latestScored,
}: {
  count: number;
  latestId: string;
  latestScored: boolean;
}) {
  const times = count === 1 ? "Retried once" : `Retried ${count}×`;
  return (
    <Link
      href={latestScored ? `/report/${latestId}#compare` : `/report/${latestId}`}
      className="vs-label"
    >
      {times} — {latestScored ? "compare latest" : "latest run is still being scored"}
    </Link>
  );
}

function ScoreRow({ overall, categories }: { overall: MetricDelta; categories: MetricDelta[] }) {
  return (
    <div className="mt-5 border-t border-l border-line">
      <div className="border-r border-b border-line p-5 sm:p-6">
        <p className="font-mono text-[0.56rem] tracking-[0.18em] uppercase text-ink-muted">
          Overall
        </p>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 font-mono text-[1.35rem] leading-none font-semibold tabular">
          <span className="text-ink-muted">{fmt(overall.then, overall.unit)}</span>
          <span aria-hidden="true" className="text-[0.6em] text-ink-muted">
            →
          </span>
          <span>{fmt(overall.now, overall.unit)}</span>
          <span className={cx("text-[0.72em]", deltaTone(overall))}>
            <span aria-hidden="true">{arrow(overall.delta)}</span>
            {fmtDelta(overall.delta, overall.unit)}
          </span>
        </p>
        <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-3">
          {categories.map((c) => (
            <p
              key={c.key}
              className="flex items-baseline justify-between gap-2 font-mono text-[0.7rem]"
            >
              <span className="text-ink-muted">{c.label}</span>
              <span className="tabular">
                <span className="text-ink-muted">{fmt(c.then, c.unit)}</span>
                <span aria-hidden="true" className="text-ink-muted">
                  {" → "}
                </span>
                {fmt(c.now, c.unit)}{" "}
                <b className={cx("font-medium", deltaTone(c))}>{fmtDelta(c.delta, c.unit)}</b>
              </span>
            </p>
          ))}
        </div>
        <Explain>
          Every number here is this run minus the earlier one, in points. The questions were
          identical, which is what makes the subtraction fair — it is the one comparison on this
          page that does not depend on the two runs having been asked the same sort of thing.
        </Explain>
      </div>
    </div>
  );
}

function DeliveryTable({ deltas }: { deltas: MetricDelta[] }) {
  return (
    <div className="mt-6 border-t border-l border-line">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] font-mono text-[0.56rem] tracking-[0.18em] uppercase text-ink-muted">
        <span className="border-r border-b border-line px-3 py-2 sm:px-4">Measured</span>
        <span className="border-r border-b border-line px-3 py-2 text-right sm:px-4">Then</span>
        <span className="border-r border-b border-line px-3 py-2 text-right sm:px-4">Now</span>
        <span className="border-r border-b border-line px-3 py-2 text-right sm:px-4">Change</span>
      </div>
      {deltas.map((d) => (
        <div
          key={d.key}
          className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] font-mono text-[0.72rem] tabular"
        >
          <span className="border-r border-b border-line px-3 py-2 break-words text-ink-soft sm:px-4">
            {d.label}
          </span>
          <span className="border-r border-b border-line px-3 py-2 text-right text-ink-muted sm:px-4">
            {fmt(d.then, d.unit)}
          </span>
          <span className="border-r border-b border-line px-3 py-2 text-right sm:px-4">
            {fmt(d.now, d.unit)}
          </span>
          <span
            className={cx(
              "border-r border-b border-line px-3 py-2 text-right sm:px-4",
              deltaTone(d),
            )}
          >
            {fmtDelta(d.delta, d.unit)}
          </span>
        </div>
      ))}
      <p className="mono-note mt-3">
        &ldquo;—&rdquo; is not measured on that run, so there is no change to report. Fewer fillers,
        shorter pauses and less head movement all read as green.
      </p>
    </div>
  );
}

function TurnPair({ turn, showChanges }: { turn: TurnComparison; showChanges: boolean }) {
  return (
    <div className="mt-6 border-t border-line pt-4">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[0.62rem] tracking-[0.16em] uppercase text-ink-muted">
          Q{turn.turn_index + 1}
        </span>
        <span className="min-w-0 text-[0.9rem] leading-snug break-words">{turn.question}</span>
      </p>

      <p className="mt-2 flex flex-wrap items-center gap-2">
        <Mean label="then" value={turn.then_mean} />
        <Mean label="now" value={turn.now_mean} />
      </p>

      {showChanges ? (
        <p className="transcript mt-3 text-[0.86rem] leading-relaxed break-words">
          <DiffText ops={turn.diff} />
        </p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <p className="tr-label">then</p>
            <p className="transcript text-[0.86rem] leading-relaxed break-words text-ink-soft">
              {turn.then_transcript}
            </p>
          </div>
          <div>
            <p className="tr-label">now</p>
            <p className="transcript text-[0.86rem] leading-relaxed break-words">
              {turn.now_transcript}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function DiffText({ ops }: { ops: DiffOp[] }) {
  return (
    <>
      {ops.map((op, i) => {
        const space = i > 0 ? " " : "";
        if (op.op === "keep") {
          return (
            <span key={i}>
              {space}
              {op.text}
            </span>
          );
        }
        if (op.op === "del") {
          return (
            <span key={i}>
              {space}
              <del className="text-ink-muted decoration-weak/70">{op.text}</del>
            </span>
          );
        }
        return (
          <span key={i}>
            {space}
            <ins className="bg-strong/15 text-ink no-underline">{op.text}</ins>
          </span>
        );
      })}
    </>
  );
}

function Mean({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="chip">
      {label} {value === null ? "—" : value.toFixed(1)}
    </span>
  );
}
