"use client";

import { useEffect, useState } from "react";
import { EXPLAIN_CLASS, EXPLAIN_EVENT, EXPLAIN_KEY } from "./explainMode";

// Re-exported so existing importers keep working; the definitions live next door
// because the root layout needs them too and is a server component.
export { EXPLAIN_CLASS, EXPLAIN_EVENT, EXPLAIN_KEY };

/**
 * The one control that flips explain mode for the whole app.
 *
 * There is no context and no provider on purpose. The state is a single class on
 * <body>, which is what lets server-rendered pages carry `<Explain>` notes
 * without becoming client components — see the `@custom-variant explain` block
 * in globals.css for the full argument.
 *
 * `aria-pressed` rather than a checkbox: this is a toggle button that changes
 * the page you are already on, not a form field that will be submitted.
 */




export function ExplainToggle({ className }: { className?: string }) {
  /**
   * Starts false and is corrected in the mount effect rather than read during
   * render. Reading localStorage while rendering would disagree with the server's
   * HTML for anyone who had it on, which is a hydration error — the class on
   * <body> is already correct by then, so this only syncs the button's own label.
   */
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(document.body.classList.contains(EXPLAIN_CLASS));
    sync();
    window.addEventListener(EXPLAIN_EVENT, sync);
    return () => window.removeEventListener(EXPLAIN_EVENT, sync);
  }, []);

  const toggle = () => {
    // Read the DOM rather than `on`: the class is what the CSS variant actually
    // keys on, and it's the only value both instances can agree about. Deriving
    // `next` from local state is what let a stale instance invert the mode.
    const next = !document.body.classList.contains(EXPLAIN_CLASS);
    document.body.classList.toggle(EXPLAIN_CLASS, next);
    try {
      localStorage.setItem(EXPLAIN_KEY, next ? "1" : "0");
    } catch {
      /* Private mode and full quotas both throw. The toggle still works for this
         page load; only the memory of it is lost, which is not worth an error. */
    }
    // After the mutation, never before — every listener, this instance included,
    // reads the class rather than being handed a value, so there is exactly one
    // source of truth.
    window.dispatchEvent(new Event(EXPLAIN_EVENT));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      /* No width utility in the base string on purpose. A caller-supplied
         `w-auto` could never beat a base `w-full`: both are (0,1,0), so the
         cascade is decided by stylesheet order, and Tailwind emits `.w-auto`
         BEFORE `.w-full`. Every caller states its own width instead, so nothing
         is ever overridden and the emitted order stops mattering. */
      className={`flex items-center gap-2.5 border px-3 py-2.5 text-left font-mono text-[0.6rem] tracking-[0.14em] uppercase transition-colors ${
        on
          ? "border-ember/45 text-ink"
          : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
      } ${className ?? ""}`}
    >
      {/* Square track, square knob. A pill switch was the one rounded thing left
          in a rail where nothing else has a corner, and it read as borrowed from
          another product. */}
      <span
        className={`relative h-3.5 w-6.5 flex-none border ${
          on ? "border-ember" : "border-line-strong"
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 left-0.5 size-2 transition-transform ${
            on ? "translate-x-3 bg-ember" : "bg-ink-muted"
          }`}
        />
      </span>
      Explain mode
    </button>
  );
}
