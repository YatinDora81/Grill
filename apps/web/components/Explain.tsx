import { cx } from "@/components/ui";

/**
 * A plain-English note under a number.
 *
 * The product measures things candidates have never been measured on before —
 * pitch variation in hertz, energy as an RMS figure, a verdict out of a hundred.
 * Every one of those is meaningless on its own, and the honest fix is not to
 * hide them but to say what they mean for the person reading.
 *
 * Deliberately NOT a client component and deliberately NOT conditionally
 * rendered. Visibility is the `explain:` variant driving `display`, which buys
 * three things: server components can use this freely, the text is in the DOM
 * for screen readers whether or not the mode is on, and flipping the toggle
 * re-renders nothing — which matters because `Reveal` observes `[data-io]`
 * exactly once at mount and never sees anything that appears later.
 *
 * Write these as what the number means, not what it measures. "How much your
 * voice moves. You don't sound flat." — not "the standard deviation of pitch".
 */
export function Explain({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cx(
        "mt-2.5 hidden border-l-2 border-ember bg-ember/5 py-1.5 pl-3 text-[0.78rem] leading-relaxed font-normal tracking-normal normal-case text-ink-soft explain:block",
        "[&_b]:font-semibold [&_b]:text-ink",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Banner confirming the mode is on.
 *
 * Without it, turning explain mode on while looking at a screen that happens to
 * carry few notes reads as a dead toggle, and people flip it back off before
 * they reach a screen where it would have helped.
 */
export function ExplainBanner() {
  return (
    /* No radius token here: `--radius-card` is 0 today, and naming it would
       quietly re-round this banner the day anyone reconsiders cards. The banner
       is square because the redesign is square, not because cards are. */
    <div className="mb-6 hidden items-center gap-3 border border-dashed border-ember/40 bg-ember/5 px-4 py-3 font-mono text-[0.63rem] tracking-[0.14em] uppercase text-ink-soft explain:flex">
      <span className="font-semibold text-ember">Explain mode is on.</span>
      <span className="max-sm:hidden">
        Every number now comes with a plain-English note underneath.
      </span>
    </div>
  );
}
