import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 border font-mono font-semibold uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS = {
  primary: "border-ink bg-ink text-paper hover:border-ember hover:bg-ember",
  secondary: "border-(--edge-control-strong) bg-transparent text-ink hover:border-ember hover:text-ember",
  ghost: "border-transparent bg-transparent text-ink-soft hover:text-ink",
  danger: "border-line bg-transparent text-ink-muted hover:border-weak hover:text-weak",
} as const;

const BUTTON_SIZES = {
  sm: "h-9 px-3.5 text-[10.5px] tracking-[0.16em]",
  md: "h-11 px-5 text-[11.5px] tracking-[0.14em]",
  lg: "h-12 px-7 text-[12.5px] tracking-[0.14em]",
} as const;

interface ButtonStyle {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & ButtonStyle) {
  return (
    <button
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & ButtonStyle) {
  return (
    <Link
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("font-display font-extrabold tracking-tight uppercase", className)}>
      grill<span className="text-ember">.</span>
    </span>
  );
}

export function Eyebrow({
  tone = "muted",
  className,
  ...props
}: ComponentProps<"p"> & { tone?: "muted" | "ember" }) {
  return (
    <p
      className={cx(
        "font-mono text-[0.6rem] tracking-[0.24em] uppercase",
        tone === "ember" ? "text-ember" : "text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-card border border-line bg-paper-raised", className)} {...props} />
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label
          htmlFor={htmlFor}
          className="font-mono text-[11px] tracking-[0.16em] uppercase text-ink-soft"
        >
          {label}
        </label>
        {hint ? <span className="font-mono text-[10.5px] text-ink-muted">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

const CONTROL =
  "w-full border border-line-strong bg-paper-sunken px-3.5 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-ember focus:bg-paper focus:outline-none focus:ring-2 focus:ring-(--focus-glow) sm:text-sm";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(CONTROL, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(CONTROL, "resize-y leading-relaxed", className)} {...props} />;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="border border-(--danger-line) bg-weak/5 px-3.5 py-2.5 font-mono text-xs text-weak"
    >
      {children}
    </p>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

export function scoreTone(score: number): "strong" | "mixed" | "weak" {
  if (score >= 75) return "strong";
  if (score >= 50) return "mixed";
  return "weak";
}

export type ScoreBandName = "rough" | "shaky" | "hireable" | "strong";

export function scoreBand(score: number): ScoreBandName {
  if (score <= 40) return "rough";
  if (score <= 60) return "shaky";
  if (score <= 80) return "hireable";
  return "strong";
}

export const BAND_LABEL: Record<ScoreBandName, string> = {
  rough: "Rough",
  shaky: "Shaky",
  hireable: "Hire-able",
  strong: "Strong",
};

const TONE_TEXT = { strong: "text-strong", mixed: "text-mixed", weak: "text-weak" } as const;
const TONE_BG = { strong: "bg-strong", mixed: "bg-mixed", weak: "bg-weak" } as const;

export function ScoreMeter({
  value,
  label,
  max = 100,
}: {
  value: number;
  label: string;
  max?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const tone = scoreTone((value / max) * 100);
  return (
    <div>
      <div
        className="h-[3px] overflow-hidden bg-(--color-track)"
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className={cx("h-full", TONE_BG[tone])} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-ink-muted">
          {label}
        </span>
        <span className={cx("tabular font-mono text-sm font-semibold", TONE_TEXT[tone])}>
          {Math.round(value)}
          <span className="text-[10px] text-ink-muted">/{max}</span>
        </span>
      </div>
    </div>
  );
}
