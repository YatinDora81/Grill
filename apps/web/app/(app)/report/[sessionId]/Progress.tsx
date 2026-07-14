import Link from "next/link";
import { Card, Eyebrow, cx } from "@/components/ui";

interface Scores {
  overall: number;
  technical: number;
  communication: number;
  problem_solving: number;
}

/**
 * This run against the one it retried. Only shown for a retry, and only when
 * the parent actually has a report — the questions were identical, so this is
 * a like-for-like measurement rather than two unrelated interviews.
 */
export function Progress({
  now,
  before,
  beforeSessionId,
  beforeDate,
}: {
  now: Scores;
  before: Scores;
  beforeSessionId: string;
  beforeDate: string;
}) {
  const rows: { label: string; a: number; b: number }[] = [
    { label: "Overall", a: before.overall, b: now.overall },
    { label: "Technical", a: before.technical, b: now.technical },
    { label: "Communication", a: before.communication, b: now.communication },
    { label: "Problem solving", a: before.problem_solving, b: now.problem_solving },
  ];

  return (
    <Card className="mt-8 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Same questions · second time</Eyebrow>
        <Link
          href={`/report/${beforeSessionId}`}
          className="font-mono text-[11px] text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          first attempt · {beforeDate}
        </Link>
      </div>

      <ul className="mt-4 space-y-3">
        {rows.map((r) => (
          <Row key={r.label} label={r.label} before={r.a} now={r.b} />
        ))}
      </ul>
    </Card>
  );
}

function Row({ label, before, now }: { label: string; before: number; now: number }) {
  const delta = now - before;
  // Rounded scores mean a delta of 0 is genuinely "no change", not a near-miss.
  const tone =
    delta > 0 ? "text-strong" : delta < 0 ? "text-weak" : "text-ink-muted";

  return (
    <li className="flex items-center gap-4">
      <span className="w-32 shrink-0 text-sm text-ink-soft">{label}</span>

      {/* Two bars on one track: where you were, and where you are now. */}
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-paper-sunken">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-line-strong"
          style={{ width: `${clamp(before)}%` }}
        />
        <span
          className={cx(
            "absolute inset-y-0 left-0 rounded-full",
            delta >= 0 ? "bg-ember" : "bg-weak",
          )}
          style={{ width: `${clamp(now)}%`, opacity: 0.85 }}
        />
      </span>

      <span className="tabular w-24 shrink-0 text-right font-mono text-xs">
        <span className="text-ink-muted">{before}</span>
        <span className="text-ink-muted"> → </span>
        <span className="text-ink">{now}</span>
      </span>
      <span className={cx("tabular w-12 shrink-0 text-right font-mono text-xs", tone)}>
        {delta > 0 ? `+${delta}` : delta < 0 ? delta : "—"}
      </span>
    </li>
  );
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
