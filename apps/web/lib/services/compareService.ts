import "server-only";
import type { Comparison, MetricDelta, TurnComparison } from "@repo/types";
import { deliveryMetricsSchema, type DeliveryMetricsParsed } from "@/lib/schemas";
import * as repo from "@/lib/db/repo";
import { diffWords, tokenizeWords } from "@/lib/diff/words";

const round = (n: number) => Math.round(n * 100) / 100;

interface MetricSpec {
  key: keyof DeliveryMetricsParsed;
  label: string;
  unit: string;
  better: MetricDelta["better"];
  scale?: number;
  zeroMeansUnmeasured?: boolean;
}

const DELIVERY_SPECS: readonly MetricSpec[] = [
  { key: "wpm", label: "Pace", unit: " wpm", better: "none", zeroMeansUnmeasured: true },
  {
    key: "avg_pause_ms",
    label: "Avg pause",
    unit: " ms",
    better: "down",
    zeroMeansUnmeasured: true,
  },
  { key: "filler_count", label: "Fillers", unit: "", better: "down" },
  { key: "pitch_variation", label: "Pitch variation", unit: " Hz", better: "up" },
  { key: "energy", label: "Energy", unit: " rms", better: "up" },
  { key: "mean_pitch_hz", label: "Mean pitch", unit: " Hz", better: "none" },
  { key: "jitter_local", label: "Jitter", unit: "%", better: "down", scale: 100 },
  { key: "shimmer_local", label: "Shimmer", unit: "%", better: "down", scale: 100 },
  { key: "hnr_db", label: "Voice clarity", unit: " dB", better: "up" },
  { key: "uptalk_pct", label: "Uptalk", unit: "%", better: "down" },
  { key: "on_camera_pct", label: "Looked at camera", unit: "%", better: "up" },
  { key: "smile_pct", label: "Smiled", unit: "%", better: "up" },
  { key: "head_motion_dps", label: "Head movement", unit: " °/s", better: "down" },
] as const;

const CATEGORY_SPECS = [
  { key: "technical", label: "Technical" },
  { key: "communication", label: "Communication" },
  { key: "problem_solving", label: "Problem solving" },
] as const;

function delta(
  key: string,
  label: string,
  then: number | null,
  now: number | null,
  unit: string,
  better: MetricDelta["better"],
): MetricDelta {
  const t = then === null ? null : round(then);
  const n = now === null ? null : round(now);
  return {
    key,
    label,
    then: t,
    now: n,
    delta: t === null || n === null ? null : round(n - t),
    unit,
    better,
  };
}

function readDelivery(value: unknown): DeliveryMetricsParsed {
  const parsed = deliveryMetricsSchema.safeParse(value);
  return parsed.success ? parsed.data : deliveryMetricsSchema.parse({});
}

function metricValue(m: DeliveryMetricsParsed, spec: MetricSpec): number | null {
  const raw = m[spec.key];
  if (typeof raw !== "number") return null;
  if (spec.zeroMeansUnmeasured && raw === 0) return null;
  return spec.scale ? raw * spec.scale : raw;
}

export function deliveryDeltas(thenColumn: unknown, nowColumn: unknown): MetricDelta[] {
  const then = readDelivery(thenColumn);
  const now = readDelivery(nowColumn);
  return DELIVERY_SPECS.map((spec) =>
    delta(
      spec.key,
      spec.label,
      metricValue(then, spec),
      metricValue(now, spec),
      spec.unit,
      spec.better,
    ),
  );
}

function categoryScore(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object") return null;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

export async function compareSessions(
  userId: string,
  sessionId: string,
): Promise<Comparison | null> {
  const session = await repo.getSession(sessionId, userId);
  if (!session?.retryOfId) return null;

  const parent = await repo.getRetryParent(session, userId);
  if (!parent?.report) return null;

  const [nowReport, nowTurns, thenTurns] = await Promise.all([
    repo.getReportBySession(session.id),
    repo.getTurns(session.id),
    repo.getTurns(parent.id),
  ]);
  if (!nowReport) return null;
  const thenReport = parent.report;

  const thenByIndex = new Map(thenTurns.map((t) => [t.turnIndex, t]));
  const turns: TurnComparison[] = nowTurns.flatMap((n) => {
    const t = thenByIndex.get(n.turnIndex);
    if (!t || t.question !== n.question) return [];
    if (!t.transcript || !n.transcript) return [];
    return [
      {
        turn_index: n.turnIndex,
        question: n.question,
        then_transcript: t.transcript,
        now_transcript: n.transcript,
        then_mean: repo.rubricMean(t.answerScores),
        now_mean: repo.rubricMean(n.answerScores),
        diff: diffWords(tokenizeWords(t.transcript), tokenizeWords(n.transcript)),
      },
    ];
  });

  return {
    parent_session_id: parent.id,
    parent_name: parent.name,
    parent_date: parent.createdAt.toISOString(),
    overall: delta("overall", "Overall", thenReport.overallScore, nowReport.overallScore, "", "up"),
    categories: CATEGORY_SPECS.map((spec) =>
      delta(
        spec.key,
        spec.label,
        categoryScore(thenReport.categoryScores, spec.key),
        categoryScore(nowReport.categoryScores, spec.key),
        "",
        "up",
      ),
    ),
    delivery: deliveryDeltas(thenReport.deliveryMetrics, nowReport.deliveryMetrics),
    turns,
  };
}
