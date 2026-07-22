import type { DeliveryMetrics } from "@repo/types";
import { cx } from "@/components/ui";

/**
 * Measured delivery — the thing this product does that a transcript can't.
 *
 * Acoustic fields are null when the audio service was unreachable, or when every
 * answer was typed. Those say "—" rather than 0: a zero would read as
 * "monotone", which is a finding, not a gap.
 */

/** The conversational band an interviewer reads as composed, in wpm. */
const COMPOSED = { lo: 110, hi: 160 } as const;
/** The scale the band sits on. Wide enough that a real outlier still lands. */
const SCALE = { lo: 80, hi: 200 } as const;

const pct = (wpm: number) => ((wpm - SCALE.lo) / (SCALE.hi - SCALE.lo)) * 100;
const clamp = (v: number) => Math.max(0, Math.min(100, v));

export function Delivery({ metrics: m }: { metrics: DeliveryMetrics }) {
  const acousticsMissing =
    m.pitch_variation === null && m.energy === null && m.mean_pitch_hz === null;
  const note = paceNote(m.wpm);

  return (
    <section className="section rv" data-io>
      <p className="kicker">Delivery — measured, not guessed</p>
      <div className="card card-hairline" style={{ marginTop: 16 }}>
        <div className="dgrid">
          <Metric label="Pace" value={m.wpm ? String(Math.round(m.wpm)) : "—"} unit="wpm">
            {note ? (
              <span className={cx("dnote", note.tone === "strong" ? "tone-strong" : "tone-mixed")}>
                {note.text}
              </span>
            ) : null}
          </Metric>
          <Metric
            label="Avg pause"
            value={m.avg_pause_ms ? String(Math.round(m.avg_pause_ms)) : "—"}
            unit="ms"
          />
          <Metric label="Fillers" value={String(m.filler_count)} unit="total" />
          <Metric
            label="Pitch variation"
            value={m.pitch_variation !== null ? m.pitch_variation.toFixed(1) : "—"}
            unit="Hz"
          />
          <Metric label="Energy" value={m.energy !== null ? m.energy.toFixed(3) : "—"} unit="rms" />
          <Metric
            label="Mean pitch"
            value={m.mean_pitch_hz !== null ? String(Math.round(m.mean_pitch_hz)) : "—"}
            unit="Hz"
          />
        </div>

        <PaceBand wpm={m.wpm} />

        {acousticsMissing ? (
          <p className="mono-note" style={{ marginTop: 16 }}>
            Tone wasn&apos;t measured for this session — either the answers were typed, or
            the audio service wasn&apos;t reachable.
          </p>
        ) : null}

        {/* The explicit {" "} is load-bearing: JSX drops the leading space of a
            text node that wraps onto the next line, and "energy← raw" is what
            you get without it. */}
        <p className="dfoot">
          <b>pace &amp; pauses</b> ← word-level timings&ensp;·&ensp;<b>pitch &amp; energy</b>{" "}
          ← raw audio&ensp;·&ensp;never the transcript
        </p>
      </div>
    </section>
  );
}

/**
 * Where this run's pace sits against the composed band. Zone and tick are both
 * derived from the same two constants the verdict above uses, so the picture and
 * the word can never disagree.
 */
function PaceBand({ wpm }: { wpm: number }) {
  const zoneLeft = pct(COMPOSED.lo);
  const zoneWidth = pct(COMPOSED.hi) - zoneLeft;

  return (
    <div className="band">
      <p className="dk">Where your pace sits</p>
      <div className="band-scale">
        <div className="band-zone" style={{ left: `${zoneLeft}%`, width: `${zoneWidth}%` }}>
          <span className="band-zone-label">
            composed band · {COMPOSED.lo}–{COMPOSED.hi}
          </span>
        </div>
        {/* No pace measured means no tick: a marker pinned at the low end would
            claim this interview was slow, when it was silent. */}
        {wpm ? (
          <div className="band-tick" style={{ left: `${clamp(pct(wpm))}%` }}>
            <span className="band-tick-label">you · {Math.round(wpm)}</span>
          </div>
        ) : null}
      </div>
      <div className="band-ends">
        <span>{SCALE.lo} · slow</span>
        <span>{SCALE.hi} · rushed</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  children,
}: {
  label: string;
  value: string;
  unit: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="dk">{label}</p>
      <p className="dv">
        {value}
        <small>{unit}</small>
        {children}
      </p>
    </div>
  );
}

/** ~110–160 wpm is the conversational band interviewers read as composed. */
export function paceNote(wpm: number): { text: string; tone: "strong" | "mixed" } | null {
  if (!wpm) return null;
  if (wpm > 175) return { text: "Rushed", tone: "mixed" };
  if (wpm < 105) return { text: "Slow", tone: "mixed" };
  return { text: "composed", tone: "strong" };
}
