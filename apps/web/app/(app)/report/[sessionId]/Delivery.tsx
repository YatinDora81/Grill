import type { DeliveryMetrics } from "@repo/types";
import { Card, cx } from "@/components/ui";

/**
 * Measured delivery. Acoustic fields are null when the audio service was
 * unreachable, or when every answer was typed — say so plainly rather than
 * printing a 0, which would read as "monotone" instead of "not measured".
 */
export function Delivery({ metrics: m }: { metrics: DeliveryMetrics }) {
  const acousticsMissing =
    m.pitch_variation === null && m.energy === null && m.mean_pitch_hz === null;

  return (
    <section className="mt-4">
      <Card className="p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-2xl tracking-tight">Delivery</h2>
          <p className="text-xs text-ink-muted">Measured, not inferred</p>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          <Metric
            label="Pace"
            value={m.wpm ? `${Math.round(m.wpm)}` : "—"}
            unit="wpm"
            note={paceNote(m.wpm)}
          />
          <Metric
            label="Avg pause"
            value={m.avg_pause_ms ? `${Math.round(m.avg_pause_ms)}` : "—"}
            unit="ms"
          />
          <Metric label="Fillers" value={String(m.filler_count)} unit="total" />
          <Metric
            label="Pitch variation"
            value={m.pitch_variation !== null ? m.pitch_variation.toFixed(1) : "—"}
            unit="Hz"
          />
          <Metric
            label="Energy"
            value={m.energy !== null ? m.energy.toFixed(3) : "—"}
            unit="rms"
          />
          <Metric
            label="Mean pitch"
            value={m.mean_pitch_hz !== null ? Math.round(m.mean_pitch_hz).toString() : "—"}
            unit="Hz"
          />
        </dl>

        {acousticsMissing && (
          <p className="mt-5 rounded-lg bg-paper-sunken px-3 py-2 text-xs text-ink-muted">
            Tone wasn&apos;t measured for this session — either the answers were typed, or
            the audio service wasn&apos;t reachable.
          </p>
        )}
      </Card>
    </section>
  );
}

function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit: string;
  note?: { text: string; tone: "strong" | "mixed" } | null;
}) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="tabular mt-0.5 font-mono text-2xl">
        {value}
        <span className="ml-1 text-xs text-ink-muted">{unit}</span>
      </dd>
      {note ? (
        <p
          className={cx(
            "mt-0.5 text-xs",
            note.tone === "strong" ? "text-strong" : "text-mixed",
          )}
        >
          {note.text}
        </p>
      ) : null}
    </div>
  );
}

/** ~110–160 wpm is the conversational band interviewers read as composed. */
function paceNote(wpm: number): { text: string; tone: "strong" | "mixed" } | null {
  if (!wpm) return null;
  if (wpm > 175) return { text: "Rushed", tone: "mixed" };
  if (wpm < 105) return { text: "Slow", tone: "mixed" };
  return { text: "Conversational", tone: "strong" };
}
