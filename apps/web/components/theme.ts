export const THEME_KEY = "grill.theme";

export const THEME_ATTR = "data-theme";

export const THEME_PREF_ATTR = "data-theme-pref";

export const THEME_EVENT = "grill:theme";

export const DARK_PAPER = "#0e0e0e";
export const LIGHT_PAPER = "#f4f0e6";

export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export const DEFAULT_PREF: ThemePref = "dark";

export function readPref(raw: string | null | undefined): ThemePref {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : DEFAULT_PREF;
}

export function resolveTheme(pref: ThemePref, prefersLight: boolean): Theme {
  if (pref === "light") return "light";
  if (pref === "system") return prefersLight ? "light" : "dark";
  return "dark";
}

export const LIGHT_QUERY = "(prefers-color-scheme: light)";
