import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS = {
  // Dark ink on ember, not white: white on #F2642F is only 3.2:1, while the
  // room's base colour clears 5.8:1 — and it matches the preview's key-light.
  primary: "bg-ember text-paper hover:bg-ember-hot",
  secondary: "border border-line-strong bg-paper-raised text-ink hover:bg-paper-sunken",
  ghost: "text-ink-soft hover:bg-paper-sunken hover:text-ink",
  danger: "border border-line-strong bg-paper-raised text-weak hover:bg-paper-sunken",
} as const;

const BUTTON_SIZES = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-7 text-base",
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

/**
 * The wordmark: lowercase, with the one ember dot. The dot is the only place
 * heat appears outside a live/primary surface — it's the brand, not decoration.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("font-display font-semibold tracking-tight", className)}>
      grill<span className="text-ember">.</span>
    </span>
  );
}

/**
 * Small mono section label. The room labels everything this way — it's what
 * keeps a dense screen readable without adding more headings.
 *
 * Colour is a `tone` prop rather than a className override: `cx` only
 * concatenates, so passing `text-ember` alongside the default `text-ink-muted`
 * leaves the winner to stylesheet order, not to the caller.
 */
export function Eyebrow({
  tone = "muted",
  className,
  ...props
}: ComponentProps<"p"> & { tone?: "muted" | "ember" }) {
  return (
    <p
      className={cx(
        "font-mono text-[11px] tracking-[0.16em] uppercase",
        tone === "ember" ? "text-ember" : "text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx("rounded-card border border-line bg-paper-raised", className)}
      {...props}
    />
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
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

const CONTROL =
  "w-full rounded-lg border border-line-strong bg-paper-raised px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-ember focus:outline-none focus:ring-2 focus:ring-ember/20";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(CONTROL, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(CONTROL, "resize-y leading-relaxed", className)} {...props} />;
}

/**
 * Inline error. role="alert" so a failed submit is announced — the message
 * often appears far from the control that caused it.
 */
export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-weak/25 bg-weak/5 px-3 py-2 text-sm text-weak"
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

/** Score → verdict colour. Shared by every score surface so the scale reads consistently. */
export function scoreTone(score: number): "strong" | "mixed" | "weak" {
  if (score >= 75) return "strong";
  if (score >= 50) return "mixed";
  return "weak";
}

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
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-soft">{label}</span>
        <span className={cx("tabular text-sm font-semibold", TONE_TEXT[tone])}>
          {Math.round(value)}
          <span className="text-ink-muted">/{max}</span>
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-paper-sunken"
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className={cx("h-full rounded-full", TONE_BG[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
