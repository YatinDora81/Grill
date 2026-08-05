import { BAND_LABEL, cx, scoreBand, type ScoreBandName } from "@/components/ui";

/**
 * Turns a bare score into a judgement.
 *
 * "72/100" tells a candidate nothing on its own — 72 against whose bar? Four
 * named bands make the number actionable: you can see you are in "hire-able" and
 * that "strong" is the next rung up.
 *
 * The labels underneath carry the meaning, so colour is never the only channel
 * and nothing is lost to a colour-blind reader. Don't drop them to save height.
 */

/**
 * Widths are the bands' REAL widths, not four equal quarters.
 *
 * `scoreBand` splits at 40 / 60 / 80, so an even four-way strip put the marker in
 * the wrong segment for about a quarter of all scores — 55 highlighted "Shaky"
 * while the tick sat under "Hire-able". On the report that strip is followed
 * immediately by a sentence naming the band, so the picture openly contradicted
 * the prose beneath it.
 *
 * Derived from the same thresholds `scoreBand` uses. If those move, these move
 * with them, so the two can never drift apart again.
 */
const BANDS: { name: ScoreBandName; upTo: number; fill: string }[] = [
  { name: "rough", upTo: 40, fill: "bg-ink-muted/20" },
  { name: "shaky", upTo: 60, fill: "bg-ink-muted/40" },
  { name: "hireable", upTo: 80, fill: "bg-strong/55" },
  { name: "strong", upTo: 100, fill: "bg-strong" },
];

/** "40fr 20fr 20fr 20fr" — one track per band, sized by the range it covers. */
const TRACKS = BANDS.map((b, i) => `${b.upTo - (BANDS[i - 1]?.upTo ?? 0)}fr`).join(" ");

export function ScoreBand({ score, className }: { score: number; className?: string }) {
  const current = scoreBand(score);
  const at = Math.min(100, Math.max(0, score));

  return (
    <div className={className}>
      {/*
       * Square and un-clipped, both deliberate. The rounded ends were the last
       * soft corner left on the dashboard; and `overflow-hidden` — which only
       * existed to clip the fills to that radius — was silently shearing the
       * marker down to the strip's own 6px, so the tick that names your score
       * never actually overhung the bar it points at.
       */}
      <div
        className="relative mt-4 grid h-1.5 border border-line"
        style={{ gridTemplateColumns: TRACKS }}
        role="img"
        aria-label={`${score} out of 100 — ${BAND_LABEL[current].toLowerCase()}`}
      >
        {BANDS.map((b) => (
          <span key={b.name} className={cx("border-r border-line last:border-r-0", b.fill)} />
        ))}
        {/* Sits above the strip rather than inside it, so it stays legible over
            the darkest band as well as the lightest. */}
        <span
          className="absolute -top-[5px] h-4 w-0.5 -translate-x-1/2 bg-ember"
          style={{ left: `${at}%` }}
          aria-hidden="true"
        />
      </div>
      {/* Same tracks as the strip above, so each label sits under its own band. */}
      <div
        className="mt-1.5 grid text-center font-mono text-[0.53rem] tracking-[0.12em] text-ink-muted uppercase"
        style={{ gridTemplateColumns: TRACKS }}
        aria-hidden="true"
      >
        {BANDS.map((b) => (
          <span key={b.name} className={b.name === current ? "text-ember" : undefined}>
            {BAND_LABEL[b.name]}
          </span>
        ))}
      </div>
    </div>
  );
}
