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

const OPTIONS: { value: ThemePref; label: string; on: string }[] = [
  {
    value: "light",
    label: "Light",
    on: "[[data-theme-pref=light]_&]:border-b-ember [[data-theme-pref=light]_&]:bg-(--wash-heat) [[data-theme-pref=light]_&]:text-(--label-on-wash)",
  },
  {
    value: "dark",
    label: "Dark",
    on: "[:root:not([data-theme-pref=light]):not([data-theme-pref=system])_&]:border-b-ember [:root:not([data-theme-pref=light]):not([data-theme-pref=system])_&]:bg-(--wash-heat) [:root:not([data-theme-pref=light]):not([data-theme-pref=system])_&]:text-(--label-on-wash)",
  },
  {
    value: "system",
    label: "System",
    on: "[[data-theme-pref=system]_&]:border-b-ember [[data-theme-pref=system]_&]:bg-(--wash-heat) [[data-theme-pref=system]_&]:text-(--label-on-wash)",
  },
];

function prefersLight() {
  return typeof window.matchMedia === "function" && window.matchMedia(LIGHT_QUERY).matches;
}

function currentPref(): ThemePref {
  return readPref(document.documentElement.getAttribute(THEME_PREF_ATTR));
}

function applyPref(pref: ThemePref) {
  const root = document.documentElement;
  const theme = resolveTheme(pref, prefersLight());
  root.setAttribute(THEME_ATTR, theme);
  root.setAttribute(THEME_PREF_ATTR, pref);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? LIGHT_PAPER : DARK_PAPER);
}

export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useState<ThemePref>(DEFAULT_PREF);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const sync = () => setPref(currentPref());
    sync();
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  useEffect(() => {
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
    } catch {}
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
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
    if (!next) return;
    e.preventDefault();
    choose(next.value);
    cells.current[to]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
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
          className={`flex-1 border-b-2 border-l border-b-transparent border-l-line px-1.5 py-2 text-center font-mono text-[0.6rem] tracking-[0.14em] text-ink-muted uppercase transition-colors first:border-l-0 hover:text-ink ${o.on}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
