"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  DARK_PAPER,
  DEFAULT_PREF,
  LIGHT_PAPER,
  LIGHT_QUERY,
  THEME_ATTR,
  THEME_EVENT,
  THEME_KEY,
  THEME_PREF_ATTR,
  readPref,
  resolveTheme,
  type ThemePref,
} from "./theme";

/**
 * The three cells, in the order the arrow keys walk them.
 *
 * `on` is the selected styling, and it is keyed off `data-theme-pref` in CSS
 * rather than off React state on purpose: the pre-paint script writes that
 * attribute before the first pixel, so the mark is already in the right cell
 * when the page paints, and only `aria-checked` has a frame to catch up. This is
 * the whole reason the stored preference gets an attribute of its own — CSS
 * cannot tell "dark" from "system that resolved to dark", but this control has
 * to.
 *
 * Typed out per option rather than interpolated because Tailwind scans this file
 * as text: a class name assembled at runtime is a class name it never emits.
 */
const OPTIONS: { value: ThemePref; label: string; on: string }[] = [
  {
    value: "light",
    label: "Light",
    on: "[[data-theme-pref=light]_&]:border-b-ember [[data-theme-pref=light]_&]:bg-(--wash-heat) [[data-theme-pref=light]_&]:text-(--label-on-wash)",
  },
  {
    value: "dark",
    label: "Dark",
    /* Matched by exclusion rather than by `[data-theme-pref=dark]`, so that the
       selector says exactly what `readPref` says: everything that is not
       explicitly light or system is dark. That also covers the two states in
       which there is no usable attribute — the pre-paint script threw on
       `localStorage`, which private mode does, and never wrote one; or something
       put an unrecognised value in it. The stylesheet paints dark in both, so
       the control has to agree with the page rather than show nothing selected. */
    on: "[:root:not([data-theme-pref=light]):not([data-theme-pref=system])_&]:border-b-ember [:root:not([data-theme-pref=light]):not([data-theme-pref=system])_&]:bg-(--wash-heat) [:root:not([data-theme-pref=light]):not([data-theme-pref=system])_&]:text-(--label-on-wash)",
  },
  {
    value: "system",
    label: "System",
    on: "[[data-theme-pref=system]_&]:border-b-ember [[data-theme-pref=system]_&]:bg-(--wash-heat) [[data-theme-pref=system]_&]:text-(--label-on-wash)",
  },
];

/** `matchMedia` is missing in some embedded UAs; there, "system" means dark. */
function prefersLight() {
  return typeof window.matchMedia === "function" && window.matchMedia(LIGHT_QUERY).matches;
}

/**
 * The stored preference, read back off <html>.
 *
 * The attribute rather than `localStorage` because it is the value every mounted
 * instance and every listener can agree about, and `readPref` narrows whatever
 * is there — so a hand-edited or half-written attribute lands on the default
 * instead of desyncing the control from the page.
 */
function currentPref(): ThemePref {
  return readPref(document.documentElement.getAttribute(THEME_PREF_ATTR));
}

/** Writes the theme everywhere it is stored outside React. */
function applyPref(pref: ThemePref) {
  const root = document.documentElement;
  const theme = resolveTheme(pref, prefersLight());
  root.setAttribute(THEME_ATTR, theme);
  root.setAttribute(THEME_PREF_ATTR, pref);
  // The pre-paint script sets `theme-color` once at load and nothing else in the
  // app would ever touch it again, so without this a reader who switches to
  // light keeps a black strip of browser chrome above a cream page — the exact
  // seam `viewportFit: cover` exists to remove.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? LIGHT_PAPER : DARK_PAPER);
}

/**
 * The one control that flips the theme for the whole app.
 *
 * Sibling of `ExplainToggle`, and built the same way: no context and no
 * provider. The state is two attributes on <html>, which is what lets every
 * server-rendered page be themed without becoming a client component — and what
 * keeps `Reveal` safe, since it observes `[data-io]` once and unobserves on
 * first intersection. A provider that re-rendered the tree on a theme change
 * would re-insert already-revealed content at `opacity: 0` with no observer left
 * to release it.
 *
 * A radiogroup rather than the explain toggle's `aria-pressed` button, because
 * there are three states and `aria-pressed` is a two-state contract — "System"
 * is not a third position on it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  /**
   * Drives `aria-checked` and the roving tabindex, and nothing that is painted.
   * Starts at the default and is corrected in the mount effect rather than read
   * during render, because reading the DOM while rendering would disagree with
   * the server's HTML for anyone who had chosen light.
   */
  const [pref, setPref] = useState<ThemePref>(DEFAULT_PREF);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const sync = () => setPref(currentPref());
    sync();
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  useEffect(() => {
    // Another tab changed the preference. `key === null` is a `clear()`, which
    // took the preference with it, so that case resolves to the default.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== THEME_KEY) return;
      applyPref(readPref(e.newValue));
      window.dispatchEvent(new Event(THEME_EVENT));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(LIGHT_QUERY);
    // Only "system" follows the OS, and the check reads the DOM rather than
    // `pref`: this listener is registered once, so a closure over the state
    // would keep answering for whatever the preference was at mount.
    const onChange = () => {
      if (currentPref() !== "system") return;
      applyPref("system");
      window.dispatchEvent(new Event(THEME_EVENT));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const choose = (next: ThemePref) => {
    applyPref(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Private mode and full quotas both throw. The theme still changes for
         this page load; only the memory of it is lost, which is not worth an
         error. */
    }
    // After the mutation, never before — every listener, this instance included,
    // re-reads the attribute rather than being handed a value, so there is
    // exactly one source of truth.
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  /**
   * Arrows move the selection AND focus, and only the selected cell is tabbable.
   * A radiogroup that answered to Tab and Enter alone would be a worse control
   * than the button it replaces, because Tab would then have to stop three times
   * on its way past a control most readers never touch.
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    // Where the move starts is read from the DOM, not from `pref`, for the same
    // reason every other mutation here is.
    const from = OPTIONS.findIndex((o) => o.value === currentPref());
    const to =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? OPTIONS.length - 1
          : step === 0
            ? -1
            : (from + step + OPTIONS.length) % OPTIONS.length;
    const next = OPTIONS[to];
    // Unreachable for every key handled above; `noUncheckedIndexedAccess` is on
    // and a non-null assertion would be a worse way to say the same thing.
    if (!next) return;
    // Otherwise the arrows scroll the rail this usually sits at the bottom of.
    e.preventDefault();
    choose(next.value);
    cells.current[to]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
      /* No width utility in the base string, for the reason `ExplainToggle`
         gives: a caller-supplied `w-auto` could never beat a base `w-full`,
         since both are (0,1,0) and Tailwind emits `.w-auto` first. Every caller
         states its own width instead. */
      className={`flex border border-line ${className ?? ""}`}
    >
      {OPTIONS.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          tabIndex={pref === o.value ? 0 : -1}
          ref={(el) => {
            cells.current[i] = el;
          }}
          onClick={() => choose(o.value)}
          /* The selected cell is marked on its bottom edge for the reason
             `AppHeader`'s section nav gives for the same mark: the row runs
             horizontally, so the edge has to sit on the axis the eye scans
             across. Square, like everything else in the rail. */
          className={`flex-1 border-b-2 border-l border-b-transparent border-l-line px-1.5 py-2 text-center font-mono text-[0.6rem] tracking-[0.14em] text-ink-muted uppercase transition-colors first:border-l-0 hover:text-ink ${o.on}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
