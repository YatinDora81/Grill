"use client";

import { useMemo } from "react";
import type { AwaySegment } from "@repo/types";
import { awayBlocks, formatAwayDuration, formatTakeOffset } from "@/lib/camera/summarize";

export function AwayStrip({
  segments,
  totalMs,
  onSeek,
}: {
  segments: AwaySegment[];
  totalMs: number;
  onSeek?: (seconds: number) => void;
}) {
  const blocks = useMemo(() => awayBlocks(segments, totalMs), [segments, totalMs]);
  if (blocks.length === 0) return null;

  return (
    <div className="mt-3.5">
      <div
        role="group"
        aria-label={`${blocks.length} moment${blocks.length === 1 ? "" : "s"} looking away from the camera`}
        className="relative h-1.5 w-full bg-line"
      >
        {blocks.map((b) => {
          const label = `Looked away for ${formatAwayDuration(b.end_ms - b.start_ms)} at ${formatTakeOffset(b.start_ms)}`;
          const style = { left: `${b.leftPct}%`, width: `${b.widthPct}%` };
          return onSeek ? (
            <button
              key={b.start_ms}
              type="button"
              title={label}
              aria-label={`${label}. Play from here.`}
              style={style}
              onClick={() => onSeek(b.start_ms / 1000)}
              className="absolute inset-y-0 bg-weak transition-opacity hover:opacity-70"
            />
          ) : (
            <span
              key={b.start_ms}
              title={label}
              style={style}
              className="absolute inset-y-0 bg-weak"
            />
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[0.6rem] tracking-[0.08em] text-ink-soft">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block size-2.5 bg-weak" aria-hidden="true" />
          looked away
        </span>
        <span className="text-ink-muted">
          {blocks.length} time{blocks.length === 1 ? "" : "s"}
          {onSeek ? " · click one to hear it" : ""}
        </span>
      </div>
    </div>
  );
}
