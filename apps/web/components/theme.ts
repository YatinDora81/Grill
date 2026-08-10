/**
 * The constants light mode is built out of.
 *
 * Its own module, and not `"use client"`, for the reason `explainMode.ts` gives:
 * both sides of the feature have to reach them. The toggle (a client component)
 * writes the preference, and the pre-paint script in the ROOT LAYOUT — a server
 * component — has to restore it before first paint. Hardcoding a second copy in
 * the layout would compile clean and silently stop the theme persisting the day
 * either name changed.
 *
 * Two things here that explain mode does not need. The preference has THREE
 * states rather than two, so the stored value and the resolved value are
 * different facts and get an attribute each. And the paper hexes live here
 * rather than only in `globals.css`, because the `theme-color` meta tag is not
 * CSS and cannot read a custom property — the layout's viewport export and the
 * pre-paint script both need the literal.
 */

/** localStorage key holding the reader's preference. */
export const THEME_KEY = "grill.theme";

/**
 * Carries the RESOLVED theme on `<html>` — `"light"` or `"dark"`, never
 * `"system"`. This is what `globals.css` keys its light scope off.
 *
 * On `<html>` rather than `<body>` because `<html>` is `:root`, which is where
 * `@theme` puts its variables and the only element on which `color-scheme` is
 * reliably honoured. A body-scoped theme leaves the root background, the
 * scrollbar gutter and the overscroll area dark — a seam at every page edge.
 *
 * An attribute rather than a class because `<html>` already carries three
 * next/font class names whose hashes change per build; a pre-paint script
 * assigning `className` would wipe the font variables before first paint.
 */
export const THEME_ATTR = "data-theme";

/**
 * Carries the STORED preference, including `"system"`.
 *
 * Separate from {@link THEME_ATTR} because CSS cannot tell `"dark"` from
 * `"system that resolved to dark"`, but the toggle's three-way indicator has to
 * be in the right position at first paint — before any effect has run.
 */
export const THEME_PREF_ATTR = "data-theme-pref";

/**
 * Broadcast after any toggle writes the preference, so every other mounted
 * toggle re-reads it.
 *
 * Same reason `EXPLAIN_EVENT` exists: the rail renders its controls TWICE, once
 * in the desktop rail and once in the mobile header, with only CSS hiding one.
 * Without a broadcast the hidden instance keeps its mount-time value forever and
 * a reader who crosses the `lg` breakpoint finds a control that disagrees with
 * the page it is sitting on.
 */
export const THEME_EVENT = "grill:theme";

/**
 * `--color-paper` in each theme, duplicated out of `globals.css` because the
 * `theme-color` meta tag is not a stylesheet and cannot read a custom property.
 * Mobile browsers paint their chrome with it, so any drift shows as a seam right
 * where `viewportFit: cover` was meant to remove one.
 *
 * A token test pins these against the values in `globals.css`; they are the one
 * pair of literals in the product allowed to restate a token.
 */
export const DARK_PAPER = "#0e0e0e";
export const LIGHT_PAPER = "#f4f0e6";

export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

/**
 * Dark, regardless of the OS.
 *
 * Deliberately not `"system"`. Dark is the design's default state and the only
 * one the server can render, so a reader who never touches the toggle — and a
 * reader with JS off — both get today's page rather than being flipped into a
 * theme they never asked for by an OS setting they may have chosen for
 * unrelated reasons. It is also why `prefers-color-scheme` is not the primary
 * mechanism anywhere in this feature.
 */
export const DEFAULT_PREF: ThemePref = "dark";

/** Narrow an unknown stored string — anything unrecognised falls back to the default. */
export function readPref(raw: string | null | undefined): ThemePref {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : DEFAULT_PREF;
}

/**
 * The single resolution rule.
 *
 * Exists as a function so the toggle and the layout's inline pre-paint script
 * cannot diverge on it — the script is hand-minified and would otherwise be a
 * second, unverifiable implementation of this one line.
 */
export function resolveTheme(pref: ThemePref, prefersLight: boolean): Theme {
  if (pref === "light") return "light";
  if (pref === "system") return prefersLight ? "light" : "dark";
  return "dark";
}

/** The media query the `"system"` state resolves against, in one place. */
export const LIGHT_QUERY = "(prefers-color-scheme: light)";
