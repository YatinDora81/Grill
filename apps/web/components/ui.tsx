import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// A button is a mono, uppercase, square slab. No radius token here on purpose:
// `--radius-card` is the surface radius, and a control that tracked it would go
// round again the day a card does. The reference wants controls square either way.
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 border font-mono font-semibold uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS = {
  // Bone fill, not ember. Ember is now a true red and reads as an alarm, so it
  // is spent on accents (the star, the trend line, an accent word) and on the
  // hover of the one button that matters. A resting ember slab would make every
  // screen shout.
  //
  // The slab is `ink` and its label is `paper`, which is the theme's maximum-
  // contrast pair whichever way round the theme is: bone on black in the dark
  // room at 15.49:1, near-black on cream on the light sheet at 16.15:1. That
  // inversion is the intent, not an accident for a `light:` override to undo —
  // a reversed-out slab is the loudest thing a two-colour press can print, and
  // this is the one button that earns it. The ember hover keeps its knockout in
  // both directions (5.68:1 and 5.17:1) because the light ember is an ink
  // rather than a lamp, so `text-paper` is still what knocks out of it.
  primary: "border-ink bg-ink text-paper hover:border-ember hover:bg-ember",
  secondary: "border-(--edge-control-strong) bg-transparent text-ink hover:border-ember hover:text-ember",
  ghost: "border-transparent bg-transparent text-ink-soft hover:text-ink",
  danger: "border-line bg-transparent text-ink-muted hover:border-weak hover:text-weak",
} as const;

// Sizes carry the type scale AND the tracking: `cx` is a plain join, so a size
// that only set height would let BASE and the caller fight over the rest.
// Uppercase mono at 0.14em sets much wider than sans, hence the smaller ramp.
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

/**
 * The wordmark: heavy uppercase, with the one ember dot. The dot is the only
 * place heat appears outside a live/primary surface — it's the brand, not
 * decoration. Uppercase now, because every other display setting in the app is,
 * and a lowercase mark was the last thing reading as a different typeface.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("font-display font-extrabold tracking-tight uppercase", className)}>
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
        // 0.6rem/0.24em, matching the reference's screen slug (`01 — DASHBOARD`).
        // Five screens were setting this by hand in three different ways; it
        // lives here now so a sixth can't invent a fourth.
        "font-mono text-[0.6rem] tracking-[0.24em] uppercase",
        tone === "ember" ? "text-ember" : "text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A flat surface with a hairline edge. `rounded-card` resolves to 0 today —
 * it stays as the token rather than being deleted because the surface radius is
 * a one-line decision that belongs in `@theme`, not in every card in the app.
 * Controls do NOT read it: a button should stay square whatever cards do.
 */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-card border border-line bg-paper-raised", className)} {...props} />
  );
}

/**
 * Label above, hint on the same baseline at the right — the `.field-row` shape
 * every hand-rolled form in the app already uses. The hint moved up from under
 * the control so that "at least 8 characters" is read before it is disobeyed,
 * not after.
 */
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

// `text-base sm:text-sm`, not a flat `text-sm`: iOS Safari force-zooms the
// whole page when you focus a field whose computed font-size is under 16px, and
// it does not zoom back out. Every login/signup/profile field did this. 16px on
// phones buys immunity; desktop keeps the intended 14px density.
//
// Callers that restyle the size must override with `sm:`-only classes — `cx` is
// a plain join, not tailwind-merge, so a bare `text-xs` here would not replace
// `text-base`, it would just race it in the cascade and win at every width.
//
// Square, and sunken rather than raised: a field is a hole in the surface, and
// on a flat card the only thing left to say "you can type here" is the depth.
//
// The ring takes `--focus-glow` rather than a fixed `ember/20` so its strength
// cannot drift from `.input:focus` in globals.css, the product's only other
// focus-reinforcement wash; that alignment costs this one four points of alpha
// on dark, 20% down to that rule's 16%. Reinforcement is all it is — the
// indicator is the 1px `focus:border-ember` beside it at 5.69:1 on a card,
// which is why the ring can afford to be a wash here and why on the sheet it
// has to more than double in strength to register at all.
const CONTROL =
  "w-full border border-line-strong bg-paper-sunken px-3.5 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-ember focus:bg-paper focus:outline-none focus:ring-2 focus:ring-(--focus-glow) sm:text-sm";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(CONTROL, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(CONTROL, "resize-y leading-relaxed", className)} {...props} />;
}

/**
 * Inline error. role="alert" so a failed submit is announced — the message
 * often appears far from the control that caused it.
 *
 * The edge is a token because it has to firm up on the sheet (35% → 55%) where
 * a translucent hairline on a bright ground all but disappears; the 5% fill
 * does not, because 5% of the light claret over cream is already a visible
 * blush. Alpha on a fixed hue has a direction — the two halves of this box move
 * by different amounts, which is exactly why only one of them is a token.
 */
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
      // One of the few survivors of the squaring: a spinner is a circle because
      // the rotation has to read, and a rotating square reads as a glitch.
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

/**
 * Score → the judgement a candidate can act on.
 *
 * Four bands, deliberately one more than `scoreTone`'s three. A colour only has
 * to say good/middling/bad; a label has to answer "would this pass?", and the
 * gap between "you'd scrape through" and "they'd argue for you" is the one that
 * decides whether someone runs another session.
 *
 * Kept SEPARATE from scoreTone rather than widening it: the report hero, the
 * profile stats, the dashboard ledger and Replay's rubric all read scoreTone,
 * and giving it a fourth band would silently recolour every one of them.
 */
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
      {/* The rule sits above the row, not under it: in the reference every
          meter is a hairline the label hangs off, so the eye reads the bar
          first and the number second.

          The track takes `--color-track`, not `bg-line`: this is the divider
          value used as a 3px SLAB, and a weight picked for a hairline cannot
          hold one once the edge direction flips. The verdict fill above it
          reads 6.33 / 6.02 / 4.26 against that track. */}
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
