import { Fragment } from "react";
import type { DeliveryPoint } from "@repo/types";
import { Explain } from "@/components/Explain";
import { cx } from "@/components/ui";

export const VIEWBOX = "0 0 160 48";

export const PLOT = { X0: 6, X1: 154, TOP: 8, BASE: 40 } as const;

export const PACE_DOMAIN = [90, 200] as const;

export const PACE_BAND = [120, 160] as const;

export const FILLER_FLOOR = 6;

export const MIN_POINTS = 2;

export type SparkKind = "pace" | "fillers";

export type Domain = readonly [number, number];

export function xOf(index: number, count: number): number {
  if (count < 2) return (PLOT.X0 + PLOT.X1) / 2;
  return PLOT.X0 + (index * (PLOT.X1 - PLOT.X0)) / (count - 1);
}

export function yOf(value: number, domain: Domain): number {
  const [lo, hi] = domain;
  const clamped = Math.max(lo, Math.min(hi, value));
  return PLOT.BASE - ((clamped - lo) / (hi - lo)) * (PLOT.BASE - PLOT.TOP);
}

export function fillerDomain(values: readonly (number | null)[]): Domain {
  let top = FILLER_FLOOR;
  for (const v of values) if (v !== null && v > top) top = v;
  return [0, Math.ceil(top)];
}

export function toSegments(
  values: readonly (number | null)[],
  domain: Domain,
): [number, number][][] {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push([xOf(i, values.length), yOf(v, domain)]);
  });
  if (run.length) runs.push(run);
  return runs;
}

export interface SparkDelta {
  magnitude: number;
  rising: boolean;
  improving: boolean | null;
  word: string;
}

function offBand(wpm: number): number {
  if (wpm < PACE_BAND[0]) return PACE_BAND[0] - wpm;
  if (wpm > PACE_BAND[1]) return wpm - PACE_BAND[1];
  return 0;
}

export function deltaOf(kind: SparkKind, prev: number, next: number): SparkDelta {
  const magnitude = Math.abs(next - prev);
  const rising = next > prev;

  if (kind === "fillers") {
    if (next < prev) return { magnitude, rising, improving: true, word: "fewer" };
    if (next > prev) return { magnitude, rising, improving: false, word: "more" };
    return { magnitude, rising, improving: null, word: "level" };
  }

  const before = offBand(prev);
  const after = offBand(next);
  if (after < before) return { magnitude, rising, improving: true, word: "steadier" };
  if (after > before) return { magnitude, rising, improving: false, word: "off pace" };
  if (after === 0) return { magnitude, rising, improving: true, word: "on pace" };
  return { magnitude, rising, improving: null, word: "level" };
}

export interface SparkModel {
  kind: SparkKind;
  values: (number | null)[];
  domain: Domain;
  segments: [number, number][][];
  last: { value: number; x: number; y: number };
  delta: SparkDelta;
  measured: number;
  gaps: number;
}

export function buildSpark(kind: SparkKind, series: readonly DeliveryPoint[]): SparkModel | null {
  const values = series.map((p) => {
    const raw = kind === "pace" ? p.wpm : p.fillers;
    return typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : null;
  });

  const measured: number[] = [];
  values.forEach((v, i) => {
    if (v !== null) measured.push(i);
  });
  if (measured.length < MIN_POINTS) return null;

  const domain = kind === "pace" ? PACE_DOMAIN : fillerDomain(values);
  const lastIndex = measured[measured.length - 1]!;
  const prevIndex = measured[measured.length - 2]!;
  const lastValue = values[lastIndex]!;

  return {
    kind,
    values,
    domain,
    segments: toSegments(values, domain),
    last: { value: lastValue, x: xOf(lastIndex, values.length), y: yOf(lastValue, domain) },
    delta: deltaOf(kind, values[prevIndex]!, lastValue),
    measured: measured.length,
    gaps: values.length - measured.length,
  };
}

interface SparkSpec {
  title: string;
  unit: string | null;
  prefix: string;
  scale: (domain: Domain) => string;
  sentence: (m: SparkModel) => string;
}

function movement(d: SparkDelta): string {
  if (d.magnitude === 0) return "level with the session before";
  return `${d.rising ? "up" : "down"} ${d.magnitude} on the session before — ${d.word}`;
}

function gapClause(gaps: number): string {
  if (gaps === 0) return "";
  if (gaps === 1) return " One session carries no measurement and breaks the line.";
  return ` ${gaps} sessions carry no measurement and break the line.`;
}

function listed(values: readonly (number | null)[]): string {
  return values.filter((v): v is number => v !== null).join(", ");
}

const SPECS: Record<SparkKind, SparkSpec> = {
  pace: {
    title: "Pace — wpm",
    unit: "wpm",
    prefix: "",
    scale: () => `scale ${PACE_DOMAIN[0]}–${PACE_DOMAIN[1]}`,
    sentence: (m) =>
      `Words per minute across ${m.measured} measured sessions, oldest to newest: ${listed(m.values)}.` +
      ` Latest ${m.last.value} words per minute, ${movement(m.delta)}.` +
      ` The shaded band is ${PACE_BAND[0]} to ${PACE_BAND[1]} words per minute, the range that reads as conversational.` +
      gapClause(m.gaps),
  },
  fillers: {
    title: "Fillers / session",
    unit: null,
    prefix: "×",
    scale: (domain) => `scale 0–${domain[1]}`,
    sentence: (m) =>
      `Filler words per session across ${m.measured} measured sessions, oldest to newest: ${listed(m.values)}.` +
      ` Latest ${m.last.value}, ${movement(m.delta)}.` +
      ` The dashed line along the bottom is zero.` +
      gapClause(m.gaps),
  },
};

function deltaTone(improving: boolean | null): string {
  if (improving === true) return "text-strong";
  if (improving === false) return "text-weak";
  return "text-ink-muted";
}

function SparkCard({ model }: { model: SparkModel }) {
  const spec = SPECS[model.kind];
  const { delta } = model;
  const bandTop = yOf(PACE_BAND[1], model.domain);
  const bandBottom = yOf(PACE_BAND[0], model.domain);

  return (
    <figure className="border border-line bg-paper-sunken p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-mono text-[0.62rem] tracking-[0.14em] text-ink-soft uppercase">
          {spec.title}
        </h3>
        <p className="font-mono text-[0.56rem] tracking-[0.1em] text-ink-muted uppercase">
          {spec.scale(model.domain)}
        </p>
      </figcaption>

      <p className="tabular mt-2 flex flex-wrap items-baseline gap-x-2 font-display text-[1.65rem] leading-none font-extrabold">
        <span>
          {spec.prefix}
          {model.last.value}
        </span>
        {spec.unit ? (
          <span className="font-mono text-[0.4em] font-medium tracking-[0.1em] text-ink-muted">
            {spec.unit}
          </span>
        ) : null}
        <span
          className={cx(
            "font-mono text-[0.45em] font-medium tracking-[0.04em]",
            deltaTone(delta.improving),
          )}
        >
          {delta.magnitude === 0 ? (
            delta.word
          ) : (
            <>
              <span aria-hidden="true">{delta.rising ? "▲" : "▼"} </span>
              {delta.magnitude} {delta.word}
            </>
          )}
        </span>
      </p>

      <svg
        viewBox={VIEWBOX}
        className="mt-3 block h-auto w-full"
        role="img"
        aria-label={spec.sentence(model)}
      >
        {model.kind === "pace" ? (
          <rect
            x={PLOT.X0}
            y={bandTop}
            width={PLOT.X1 - PLOT.X0}
            height={bandBottom - bandTop}
            className="fill-(--chart-area)"
          />
        ) : (
          <line
            x1={PLOT.X0}
            x2={PLOT.X1}
            y1={PLOT.BASE}
            y2={PLOT.BASE}
            strokeDasharray="2 4"
            className="stroke-(--chart-guide) [stroke-width:1]"
          />
        )}

        {model.segments.map((run, i) => (
          <Fragment key={i}>
            {run.length > 1 ? (
              <polyline
                points={run.map(([x, y]) => `${x},${y}`).join(" ")}
                className="fill-none stroke-ink-soft [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.2]"
              />
            ) : (
              <circle cx={run[0]![0]} cy={run[0]![1]} r="1.7" className="fill-ink-soft" />
            )}
          </Fragment>
        ))}

        <circle
          cx={model.last.x}
          cy={model.last.y}
          r="2.6"
          className="fill-ember stroke-ember [stroke-width:1]"
        />
      </svg>
    </figure>
  );
}

export function DeliverySpark({ series }: { series: DeliveryPoint[] }) {
  const pace = buildSpark("pace", series);
  const fillers = buildSpark("fillers", series);
  if (!pace && !fillers) return null;

  return (
    <section className="rv mt-7 border border-line" data-io aria-label="How you sounded over time">
      <div className="flex items-baseline justify-between gap-4 border-b border-line px-6 py-3.5 font-mono text-[0.62rem] tracking-[0.2em] text-ink-muted uppercase">
        <h2 className="font-medium text-ink">How you sounded</h2>
        <span className="max-sm:hidden">{series.length} scored · no smoothing</span>
      </div>
      <div className="px-6 pt-4 pb-5">
        <div className={cx("grid gap-4", pace !== null && fillers !== null && "sm:grid-cols-2")}>
          {pace ? <SparkCard model={pace} /> : null}
          {fillers ? <SparkCard model={fillers} /> : null}
        </div>
        <Explain>
          Pace is words per minute across a whole session; fillers is how many &ldquo;um&rdquo;s and
          &ldquo;like&rdquo;s the report counted in it. Both scales are fixed — pace to{" "}
          {PACE_DOMAIN[0]}–{PACE_DOMAIN[1]} wpm, fillers from zero — so a two-point wobble
          can&rsquo;t be dressed up as a leap. The shaded band on the pace chart is the range that
          reads as conversational: faster is nerves, slower is stalling.{" "}
          <b>A break in a line is a session nobody could measure, not a perfect run.</b>
        </Explain>
      </div>
    </section>
  );
}
