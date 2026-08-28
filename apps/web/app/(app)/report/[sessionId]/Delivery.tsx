import type { DeliveryMetrics } from "@repo/types";
import { Explain } from "@/components/Explain";
import { cx } from "@/components/ui";

export const COMPOSED = { lo: 110, hi: 160 } as const;
const SCALE = { lo: 80, hi: 200 } as const;

const pct = (wpm: number) => ((wpm - SCALE.lo) / (SCALE.hi - SCALE.lo)) * 100;
const clamp = (v: number) => Math.max(0, Math.min(100, v));

export type DeliverySubject = "you" | "them";

const VOICE = {
  you: { they: "you", their: "your", tick: "you" },
  them: { they: "they", their: "their", tick: "them" },
} as const;

type Voice = (typeof VOICE)[DeliverySubject];

export function Delivery({
  metrics: m,
  subject = "you",
}: {
  metrics: DeliveryMetrics;
  subject?: DeliverySubject;
}) {
  const acousticsMissing =
    m.pitch_variation === null && m.energy === null && m.mean_pitch_hz === null;
  const note = paceNote(m.wpm);
  const v = VOICE[subject];

  return (
    <div className="mt-4 border-t border-l border-line">
      <div className="grid grid-cols-2 md:grid-cols-3">
        <Metric
          label="Pace"
          value={m.wpm ? String(Math.round(m.wpm)) : "—"}
          unit="wpm"
          note={paceExplain(m.wpm, v)}
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
          note={pauseExplain(m.avg_pause_ms, v)}
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
              ? `How much ${v.their} voice moves while ${v.they} talk. The bigger the number, the less flat ${v.they} sound.`
              : null
          }
        />
        <Metric
          label="Energy"
          value={m.energy !== null ? m.energy.toFixed(3) : "—"}
          unit="rms"
          note={
            m.energy !== null
              ? `How loudly ${v.they} spoke, straight off the waveform. It's a relative level, not decibels — compare it against ${v.their} own other runs.`
              : null
          }
        />
        <Metric
          label="Mean pitch"
          value={m.mean_pitch_hz !== null ? String(Math.round(m.mean_pitch_hz)) : "—"}
          unit="Hz"
          note={
            m.mean_pitch_hz !== null
              ? `The average pitch of ${v.their} voice. It says nothing about how ${v.they} did — it's the baseline the variation is measured against.`
              : null
          }
        />
      </div>

      <div className="border-r border-b border-line p-5 sm:p-6">
        <PaceBand wpm={m.wpm} voice={v} />

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

function PaceBand({ wpm, voice }: { wpm: number; voice: Voice }) {
  const zoneLeft = pct(COMPOSED.lo);
  const zoneWidth = pct(COMPOSED.hi) - zoneLeft;

  return (
    <div>
      <p className="dk">Where {voice.their} pace sits</p>
      <div className="band-scale">
        <div className="band-zone" style={{ left: `${zoneLeft}%`, width: `${zoneWidth}%` }}>
          <span className="band-zone-label">
            composed band · {COMPOSED.lo}–{COMPOSED.hi}
          </span>
        </div>
        {wpm ? (
          <div className="band-tick" style={{ left: `${clamp(pct(wpm))}%` }}>
            <span className="band-tick-label">
              {voice.tick} · {Math.round(wpm)}
            </span>
          </div>
        ) : null}
      </div>
      <div className="band-ends">
        <span>{SCALE.lo} · slow</span>
        <span>{SCALE.hi} · rushed</span>
      </div>
      <Explain>
        The whole bar is words a minute, from {SCALE.lo} to {SCALE.hi}. The lit strip is the stretch
        interviewers hear as composed{wpm ? `, and the tick is ${voice.tick}` : ""}.
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
  note?: React.ReactNode;
}) {
  return (
    <div className="border-r border-b border-line p-5 sm:p-6">
      <p className="font-mono text-[0.56rem] tracking-[0.18em] uppercase text-ink-muted">{label}</p>
      <p className="mt-2 font-mono text-[1.35rem] leading-none font-semibold tabular">
        {value}
        <small className="ml-1 text-[0.5em] font-normal text-ink-muted">{unit}</small>
      </p>
      {note ? <Explain>{note}</Explain> : null}
      {children}
    </div>
  );
}

export function paceNote(wpm: number): { text: string; tone: "strong" | "mixed" } | null {
  if (!wpm) return null;
  if (wpm > 175) return { text: "Rushed", tone: "mixed" };
  if (wpm < 105) return { text: "Slow", tone: "mixed" };
  return { text: "composed", tone: "strong" };
}

function paceExplain(wpm: number, voice: Voice): string | null {
  if (!wpm) return null;
  return `How fast ${voice.they} spoke. ${COMPOSED.lo}–${COMPOSED.hi} words a minute is the stretch an interviewer hears as composed: slower and ${voice.they} sound unsure of the answer, faster and the interviewer stops following it.`;
}

function pauseExplain(ms: number, voice: Voice): string | null {
  if (!ms) return null;
  return `The average gap between ${voice.their} words. Short gaps read as fluent, long ones read as hesitation — a pause is only a problem when it lands mid-sentence.`;
}

function fillerExplain(count: number): string {
  if (count === 0) return "Not one um, uh or like in the whole interview.";
  return "Every um, uh and like, counted across the whole interview. A handful is normal speech; a pile of them is what people mean when they say someone sounded nervous.";
}
