import { BAND_LABEL, cx, scoreBand, type ScoreBandName } from "@/components/ui";

const BANDS: { name: ScoreBandName; upTo: number; fill: string }[] = [
  { name: "rough", upTo: 40, fill: "bg-(--color-band-empty)" },
  { name: "shaky", upTo: 60, fill: "bg-(--color-band-low)" },
  { name: "hireable", upTo: 80, fill: "bg-(--color-band-partial)" },
  { name: "strong", upTo: 100, fill: "bg-strong" },
];

const TRACKS = BANDS.map((b, i) => `${b.upTo - (BANDS[i - 1]?.upTo ?? 0)}fr`).join(" ");

export function ScoreBand({ score, className }: { score: number; className?: string }) {
  const current = scoreBand(score);
  const at = Math.min(100, Math.max(0, score));

  return (
    <div className={className}>
      <div
        className="relative mt-4 grid h-1.5 border border-line"
        style={{ gridTemplateColumns: TRACKS }}
        role="img"
        aria-label={`${score} out of 100 — ${BAND_LABEL[current].toLowerCase()}`}
      >
        {BANDS.map((b) => (
          <span key={b.name} className={cx("border-r border-line last:border-r-0", b.fill)} />
        ))}
        <span
          className="absolute -top-[5px] h-4 w-0.5 -translate-x-1/2 bg-ember"
          style={{ left: `${at}%` }}
          aria-hidden="true"
        />
      </div>
      <div
        className="mt-1.5 grid text-center font-mono text-[0.53rem] tracking-[0.07em] whitespace-nowrap text-ink-muted uppercase"
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
