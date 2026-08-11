"use client";

import { useMemo } from "react";
import type { TranscriptWord } from "@repo/types";
import { cx } from "@/components/ui";
import { fillerWordFlags } from "@/lib/fillers";

export function activeWordIndex(words: TranscriptWord[], currentTime: number | null): number {
  if (currentTime === null) return -1;
  let lo = 0;
  let hi = words.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.start <= currentTime) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

const LEGEND = [
  { swatch: "bg-ink", label: "spoken" },
  { swatch: "bg-ember", label: "current word" },
  { swatch: "bg-ink-muted", label: "upcoming" },
  { swatch: "bg-weak", label: "filler" },
] as const;

export function KaraokeTranscript({
  words,
  currentTime,
  onSeek,
}: {
  words: TranscriptWord[];
  currentTime: number | null;
  onSeek?: (seconds: number) => void;
}) {
  const fillers = useMemo(() => fillerWordFlags(words.map((w) => w.word)), [words]);
  const active = useMemo(() => activeWordIndex(words, currentTime), [words, currentTime]);
  const fillerCount = useMemo(
    () => fillers.reduce((n, on, i) => (on && !fillers[i - 1] ? n + 1 : n), 0),
    [fillers],
  );
  const plain = useMemo(() => words.map((w) => w.word.trim()).join(" "), [words]);
  const running = active >= 0;

  return (
    <div>
      <p className="max-w-[66ch] text-[0.95rem] leading-[1.9]">
        <span className="sr-only">“{plain}”</span>
        <span aria-hidden="true">
          {words.map((w, i) => {
            const filler = fillers[i] ?? false;
            const now = i === active;
            const className = cx(
              "inline px-[2px] text-left select-text",
              onSeek && "cursor-pointer",
              filler ? "text-weak" : !running || i <= active ? "text-ink" : "text-ink-muted",
              filler && "underline decoration-weak decoration-dotted underline-offset-[5px]",
              now && "bg-ember-soft",
              now && !filler && "karaoke-now underline decoration-ember underline-offset-[5px]",
            );
            const text = w.word.trim() || w.word;
            return onSeek ? (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                className={className}
                onClick={() => onSeek(w.start)}
              >
                {text}{" "}
              </button>
            ) : (
              <span key={i} className={className}>
                {text}{" "}
              </span>
            );
          })}
        </span>
      </p>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[0.6rem] tracking-[0.08em] text-ink-soft">
        {LEGEND.map((k) => (
          <span className="inline-flex items-center gap-2" key={k.label}>
            <span className={cx("inline-block size-2.5", k.swatch)} aria-hidden="true" />
            {k.label}
          </span>
        ))}
        {fillerCount > 0 ? (
          <span className="chip chip-error">
            ×{fillerCount} filler{fillerCount === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
    </div>
  );
}
