import type { DeliveryMetrics } from "@repo/types";
import { Explain } from "@/components/Explain";
import { cx } from "@/components/ui";

/**
 * Measured delivery — the thing this product does that a transcript can't.
 *
 * Acoustic fields are null when the audio service was unreachable, or when every
 * answer was typed. Those say "—" rather than 0: a zero would read as
 * "monotone", which is a finding, not a gap.
 *
 * The plain-English lines under each number are written here, not asked of the
 * model: none of this is LLM-authored, and the report prompt explicitly forbids
 * inferring tone from transcript text. A note that only exists when there is a
 * measurement behind it is the whole point.
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
    /* One hairline lattice, not a card: the container draws the top and left
       edges and every cell the right and bottom, so the figures read as a
       single instrument panel and the grid can reflow at any breakpoint without
       a `:first-child` exception. The section heading lives in page.tsx with
       the report's other three. */
    <div className="mt-4 border-t border-l border-line">
      <div className="grid grid-cols-2 md:grid-cols-3">
        <Metric
          label="Pace"
          value={m.wpm ? String(Math.round(m.wpm)) : "—"}
          unit="wpm"
          note={paceExplain(m.wpm)}
        >
          {note ? (
            <span
              className={cx(
                "mt-2 block font-mono text-[0.58rem] tracking-[0.1em] uppercase",
                note.tone === "strong" ? "tone-strong" : "tone-mixed",
              )}
            >
              {note.text}
            </span>
          ) : null}
        </Metric>
        <Metric
          label="Avg pause"
          value={m.avg_pause_ms ? String(Math.round(m.avg_pause_ms)) : "—"}
          unit="ms"
          note={pauseExplain(m.avg_pause_ms)}
        />
        <Metric
          label="Fillers"
          value={String(m.filler_count)}
          unit="total"
          note={fillerExplain(m.filler_count)}
        />
        <Metric
          label="Pitch variation"
          value={m.pitch_variation !== null ? m.pitch_variation.toFixed(1) : "—"}
          unit="Hz"
          note={
            m.pitch_variation !== null
              ? "How much your voice moves while you talk. The bigger the number, the less flat you sound."
              : null
          }
        />
        <Metric
          label="Energy"
          value={m.energy !== null ? m.energy.toFixed(3) : "—"}
          unit="rms"
          note={
            m.energy !== null
              ? "How loudly you spoke, straight off the waveform. It's a relative level, not decibels — compare it against your own other runs."
              : null
          }
        />
        <Metric
          label="Mean pitch"
          value={m.mean_pitch_hz !== null ? String(Math.round(m.mean_pitch_hz)) : "—"}
          unit="Hz"
          note={
            m.mean_pitch_hz !== null
              ? "The average pitch of your voice. It says nothing about how you did — it's the baseline the variation is measured against."
              : null
          }
        />
      </div>

      {/* Below the figures and inside the same box: the scale is what the pace
          cell above means, and splitting them into two panels made the reader
          carry a number across a gap. */}
      <div className="border-r border-b border-line p-5 sm:p-6">
        <PaceBand wpm={m.wpm} />

        {acousticsMissing ? (
          <p className="mono-note" style={{ marginTop: 16 }}>
            Tone wasn&apos;t measured for this session — either the answers were typed, or the audio
            service wasn&apos;t reachable.
          </p>
        ) : null}

        {/* The explicit {" "} is load-bearing: JSX drops the leading space of a
            text node that wraps onto the next line, and "energy← raw" is what
            you get without it. */}
        <p className="dfoot">
          <b>pace &amp; pauses</b> ← word-level timings&ensp;·&ensp;<b>pitch &amp; energy</b> ← raw
          audio&ensp;·&ensp;never the transcript
        </p>
      </div>
    </div>
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
    /* No `.band` wrapper any more — it drew its own dashed rule and top margin
       to separate itself from the metric grid, and the cell border above now
       does that job. */
    <div>
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
      <Explain>
        The whole bar is words a minute, from {SCALE.lo} to {SCALE.hi}. The lit strip is the stretch
        interviewers hear as composed{wpm ? ", and the tick is you" : ""}.
      </Explain>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  children,
  note,
}: {
  label: string;
  value: string;
  unit: string;
  children?: React.ReactNode;
  /** Plain English, shown only in explain mode. Omit it where nothing was measured. */
  note?: React.ReactNode;
}) {
  return (
    <div className="border-r border-b border-line p-5 sm:p-6">
      <p className="font-mono text-[0.56rem] tracking-[0.18em] uppercase text-ink-muted">{label}</p>
      <p className="mt-2 font-mono text-[1.35rem] leading-none font-semibold tabular">
        {value}
        <small className="ml-1 text-[0.5em] font-normal text-ink-muted">{unit}</small>
      </p>
      {/* Outside the figure's paragraph, not inside it: `Explain` renders a <p>,
          and a nested <p> is closed by the parser before React ever sees it. */}
      {note ? <Explain>{note}</Explain> : null}
      {/* Last, so the plain-English line sits with the number it explains and
          the judgement closes the cell. */}
      {children}
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

/**
 * The bands are stated from the same constants the verdict and the picture use,
 * so nobody can read three different numbers off one metric.
 */
function paceExplain(wpm: number): string | null {
  if (!wpm) return null;
  return `How fast you spoke. ${COMPOSED.lo}–${COMPOSED.hi} words a minute is the stretch an interviewer hears as composed: slower and you sound unsure of the answer, faster and they stop following it.`;
}

function pauseExplain(ms: number): string | null {
  if (!ms) return null;
  return "The average gap between your words. Short gaps read as fluent, long ones read as hesitation — a pause is only a problem when it lands mid-sentence.";
}

function fillerExplain(count: number): string {
  if (count === 0) return "Not one um, uh or like in the whole interview.";
  return "Every um, uh and like, counted across the whole interview. A handful is normal speech; a pile of them is what people mean when they say someone sounded nervous.";
}
