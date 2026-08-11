import { Fragment } from "react";
import Link from "next/link";
import type { RetryChain as RetryChainData } from "@repo/types";
import { UNTITLED } from "@/lib/interviewMeta";
import { cx, scoreTone } from "@/components/ui";

const HOP_TONE = {
  strong: "text-strong",
  mixed: "text-mixed",
  weak: "text-weak",
} as const;

export function RetryChain({ chain }: { chain: RetryChainData | null }) {
  if (!chain || chain.hops.length < 2) return null;
  const label = chain.name?.trim() || UNTITLED;

  return (
    <section
      className="rv mt-7 flex flex-wrap items-center gap-x-3 gap-y-2.5 border border-line bg-paper-sunken px-5 py-4"
      data-io
      aria-label={`Reruns of ${label}, oldest first`}
    >
      <span className="font-mono text-[0.62rem] tracking-[0.12em] text-ink-soft uppercase">
        {label}
      </span>

      {chain.hops.map((hop, i) => (
        <Fragment key={hop.session_id}>
          {i > 0 ? (
            <span className="font-mono text-[0.72rem] text-ink-muted" aria-hidden="true">
              →
            </span>
          ) : null}
          <Link
            href={`/report/${hop.session_id}`}
            aria-label={`Run ${i + 1} of ${chain.hops.length}, scored ${hop.overall_score} out of 100 — open its report`}
            className="border border-line-strong px-2.5 py-1 font-mono text-[0.68rem] tracking-[0.06em] transition-colors hover:border-ember hover:bg-(--surface-hover)"
          >
            <span className="text-ink-soft">v{i + 1}</span>{" "}
            <span className={cx("tabular font-semibold", HOP_TONE[scoreTone(hop.overall_score)])}>
              {hop.overall_score}
            </span>
          </Link>
        </Fragment>
      ))}

      <span className="ml-auto border border-line px-2 py-1 font-mono text-[0.56rem] tracking-[0.14em] text-ink-muted uppercase max-sm:hidden">
        same questions · comparable
      </span>
    </section>
  );
}
