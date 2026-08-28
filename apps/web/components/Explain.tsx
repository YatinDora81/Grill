import { cx } from "@/components/ui";

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

export function ExplainBanner() {
  return (
    <div className="mb-6 hidden items-center gap-3 border border-dashed border-ember/40 bg-ember/5 px-4 py-3 font-mono text-[0.63rem] tracking-[0.14em] uppercase text-ink-soft explain:flex">
      <span className="font-semibold text-ember">Explain mode is on.</span>
      <span className="max-sm:hidden">
        Every number now comes with a plain-English note underneath.
      </span>
    </div>
  );
}
