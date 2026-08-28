import type { StarBreakdown, StarLabel, StarSegment } from "@repo/types";
import { Explain } from "@/components/Explain";
import { cx } from "@/components/ui";

const NAMES: Record<StarLabel, string> = {
  S: "Situation",
  T: "Task",
  A: "Action",
  R: "Result",
  other: "Other",
};

const SWATCH: Record<StarLabel, string> = {
  S: "bg-ink-muted",
  T: "bg-ink-soft",
  A: "bg-ember",
  R: "bg-strong",
  other: "bg-line",
};

const PARTS = ["S", "T", "A", "R"] as const;

const THIN_SHARE = 10;

const QUOTE_MAX_CHARS = 70;

export function StarBar({
  breakdown,
  showQuotes = true,
}: {
  breakdown: StarBreakdown | null;
  showQuotes?: boolean;
}) {
  if (!breakdown || breakdown.segments.length === 0) return null;

  const weights = segmentWeights(breakdown.segments);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  const summary = PARTS.map((p) => `${NAMES[p]} ${pct(breakdown.share[p])}%`).join(", ");

  return (
    <div>
      <p className="tr-label">How the answer was built</p>

      <div
        className="mt-1.5 flex h-2.5 w-full overflow-hidden border border-line"
        role="img"
        aria-label={`STAR split of this answer: ${summary}.`}
      >
        {breakdown.segments.map((seg, i) => {
          const width = (weights[i]! / total) * 100;
          if (width <= 0) return null;
          return (
            <span
              key={i}
              className={cx("block h-full", SWATCH[seg.label])}
              style={{ width: `${width}%` }}
              title={segmentTitle(seg, breakdown.basis, showQuotes)}
            />
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {legendOrder(breakdown).map((label) => {
          const value = breakdown.share[label];
          const thin = label !== "other" && value < THIN_SHARE;
          return (
            <span
              key={label}
              className="flex items-center gap-1.5 font-mono text-[0.58rem] tracking-[0.1em] uppercase"
            >
              <span className={cx("size-2 flex-none", SWATCH[label])} aria-hidden="true" />
              <span className={thin ? "tone-weak" : "text-ink-muted"}>
                {NAMES[label]} {pct(value)}%
              </span>
            </span>
          );
        })}
      </div>

      {breakdown.missing.length > 0 ? (
        <p className="mt-2.5 flex flex-wrap gap-2">
          {breakdown.missing.map((label) => (
            <span key={label} className="chip chip-error">
              No {NAMES[label]}
            </span>
          ))}
        </p>
      ) : null}

      {breakdown.note ? (
        <p className="mono-note" style={{ marginTop: 10 }}>
          {breakdown.note}
        </p>
      ) : null}

      <Explain>
        Interviewers listen for four things in a story answer: the <b>Situation</b> you were in, the{" "}
        <b>Task</b> you owned, the <b>Action</b> you personally took, and the <b>Result</b> it
        produced. The bar is this answer in the order you said it, sized by{" "}
        {breakdown.basis === "time" ? "how long each part took" : "how many words each part used"}.
        Most answers that land badly are mostly Situation.
      </Explain>
    </div>
  );
}

function legendOrder(b: StarBreakdown): StarLabel[] {
  return b.share.other > 0 ? [...PARTS, "other"] : [...PARTS];
}

function segmentWeights(segments: StarSegment[]): number[] {
  const raw = segments.map((s) => Math.max(0, s.end - s.start));
  const total = raw.reduce((a, b) => a + b, 0);
  return total > 0 ? raw : segments.map(() => 1);
}

function pct(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function segmentTitle(
  seg: StarSegment,
  basis: StarBreakdown["basis"],
  showQuotes: boolean,
): string {
  const where =
    basis === "time"
      ? `${clock(seg.start)}–${clock(seg.end)}`
      : `words ${Math.round(seg.start) + 1}–${Math.round(seg.end)}`;
  const head = `${NAMES[seg.label]} · ${where}`;
  const quote = showQuotes ? clip(seg.text) : "";
  return quote ? `${head} · “${quote}”` : head;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function clip(text: string): string {
  const t = text.trim();
  return t.length > QUOTE_MAX_CHARS ? `${t.slice(0, QUOTE_MAX_CHARS - 1)}…` : t;
}
