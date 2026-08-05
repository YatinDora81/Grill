/**
 * The three strings explain mode is built out of.
 *
 * Their own module, and not `"use client"`, because both sides of this feature
 * have to reach them: the toggle (a client component) writes the class, and the
 * pre-paint script in the ROOT LAYOUT — a server component — has to restore it
 * before first paint. Left on the toggle, the layout either imports across a
 * client boundary for two string constants or, as it did, hardcodes its own
 * copies under a docblock claiming they "can never drift apart" while nothing
 * enforced it. Renaming one would have compiled clean and silently stopped the
 * mode persisting across reloads.
 */

/** localStorage key holding the reader's preference. */
export const EXPLAIN_KEY = "grill.explain";

/**
 * The class on <body> that the `explain:` Tailwind variant keys off. Applied
 * before paint by the root layout's inline script, so a reader who left the mode
 * on doesn't watch every note pop in after hydration.
 */
export const EXPLAIN_CLASS = "explain";

/**
 * Broadcast so that every mounted toggle re-reads the class after any one of
 * them writes it.
 *
 * The rail renders the toggle TWICE — once in the desktop rail, once in the
 * mobile header — and only CSS hides one, so both are always mounted with their
 * own `useState`. Without a broadcast the hidden one keeps its mount-time value
 * forever, and a reader who crosses the `lg` breakpoint finds a button whose
 * knob and `aria-pressed` disagree with what's on screen, and whose first press
 * does nothing but re-assert the state it's already in.
 */
export const EXPLAIN_EVENT = "grill:explain";
