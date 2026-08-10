/**
 * The theme's load-bearing invariants, as a test rather than as a memory.
 *
 * Light mode is ~120 hand-typed values across three token blocks in one 7000-line
 * stylesheet. Nothing about it is enforced by the type system, and three of its
 * rules are the deliberate REVERSE of the dark set — so the failure mode is not a
 * crash, it is someone six months from now "fixing" a value toward its dark
 * counterpart and quietly breaking a contrast floor or leaking light into the
 * interview room. Every assertion below exists because it caught something, or
 * because the spec named it as the thing most likely to rot.
 *
 * Parsed out of the CSS rather than asserted against a snapshot: a snapshot would
 * fail on every reflow of the file and teach people to regenerate it unread.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { DARK_PAPER, LIGHT_PAPER, resolveTheme } from "@/components/theme";

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Body of every block whose selector is exactly `sel`, brace-matched. */
function blocks(sel: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = CSS.indexOf(sel, from);
    if (at === -1) break;
    from = at + sel.length;
    // Reject `:root[data-theme="light"] .room-root` when asked for the bare one.
    const open = CSS.indexOf("{", at);
    if (open === -1) break;
    if (CSS.slice(at + sel.length, open).trim() !== "") continue;
    let i = open + 1;
    for (let depth = 1; depth > 0; i++) depth += (CSS[i] === "{" ? 1 : 0) - (CSS[i] === "}" ? 1 : 0);
    out.push(CSS.slice(open + 1, i - 1));
  }
  return out;
}

function declsOf(body: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const [, k, v] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) m.set(k, v.trim());
  return m;
}

const merge = (bodies: string[]) => {
  const m = new Map<string, string>();
  for (const b of bodies) for (const [k, v] of declsOf(b)) m.set(k, v);
  return m;
};

const DARK = merge([...blocks("@theme"), ...blocks(":root")]);
const LIGHT = merge(blocks(':root[data-theme="light"]'));
const PIN = merge(blocks(':root[data-theme="light"] .room-root'));

/** Resolve a token to a hex, following var() and flattening color-mix over an opaque base. */
function hex(token: string, scope: Map<string, string>): string {
  const seen = new Set<string>();
  let v = scope.get(token) ?? DARK.get(token) ?? token;
  while (v.startsWith("var(")) {
    const name = v.slice(4, v.indexOf(")")).trim();
    if (seen.has(name)) break;
    seen.add(name);
    v = scope.get(name) ?? DARK.get(name) ?? name;
  }
  return v.trim();
}

const rgb = (h: string): [number, number, number] => {
  const s = h.replace("#", "");
  const f = s.length === 3 ? s.replace(/./g, (c) => c + c) : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as [number, number, number];
};

const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** WCAG 2.x contrast ratio, rounded to two places so a message reads like the spec. */
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return Math.round(((x! + 0.05) / (y! + 0.05)) * 100) / 100;
}

const MODES: Array<[string, Map<string, string>]> = [
  ["dark", DARK],
  ["light", new Map([...DARK, ...LIGHT])],
];

describe("theme plumbing", () => {
  it("resolves the three preference states, defaulting to dark on an unset OS hint", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });

  it("keeps the theme-color literals equal to --color-paper in each mode", () => {
    // These two are the only literals in the product allowed to restate a token:
    // <meta name="theme-color"> is not a stylesheet and cannot read a var().
    expect(DARK.get("--color-paper")).toBe(DARK_PAPER);
    expect(LIGHT.get("--color-paper")).toBe(LIGHT_PAPER);
  });

  it("leaves dark reachable with no attribute at all, for a JS-off reader", () => {
    // The server renders no data-theme, so dark MUST be the bare default rather
    // than something a `[data-theme="dark"]` rule opts into.
    expect(DARK.get("--color-paper")).toBeDefined();
    expect(CSS).toMatch(/:root\s*\{\s*color-scheme:\s*dark/);
  });
});

describe("the room pin", () => {
  it("re-declares every token the light block overrides", () => {
    // Without this the hot seat — a webcam surface, deliberately dark in both
    // themes — inherits light values for anything the pin forgot.
    const missing = [...LIGHT.keys()].filter((k) => !PIN.has(k));
    expect(missing).toEqual([]);
  });

  it("re-declares every token whose value bakes in another token", () => {
    // Subtler than the rule above and the reason it is not sufficient: a custom
    // property's var()s are substituted where it is DECLARED, not where it is
    // used. `--meter-fill-grad: linear-gradient(…, var(--color-ember), …)` on
    // :root is already flattened to the LIGHT ember by the time it inherits into
    // .room-root, so re-pinning --color-ember underneath cannot undo it.
    const indirect = [...DARK].filter(([, v]) => v.includes("var(--color-")).map(([k]) => k);
    expect(indirect.filter((k) => !PIN.has(k))).toEqual([]);
  });

  it("pins the room back to the dark surface and ink", () => {
    expect(hex("--color-paper", PIN)).toBe(DARK_PAPER);
    expect(hex("--color-ink", PIN)).toBe(DARK.get("--color-ink"));
    expect(hex("--color-ember", PIN)).toBe(DARK.get("--color-ember"));
  });
});

describe.each(MODES)("contrast floors — %s", (mode, scope) => {
  const P = hex("--color-paper", scope);
  const R = hex("--color-paper-raised", scope);
  const S = hex("--color-paper-sunken", scope);

  it("clears AAA for body ink on all three surfaces", () => {
    for (const bg of [P, R, S]) {
      expect(ratio(hex("--color-ink", scope), bg)).toBeGreaterThanOrEqual(7);
    }
  });

  it("clears AA for the two quieter inks, which carry real labels", () => {
    for (const t of ["--color-ink-soft", "--color-ink-muted"]) {
      expect(ratio(hex(t, scope), P)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hex(t, scope), R)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps ember usable as the focus ring and under knocked-out type", () => {
    // WCAG 1.4.11: the focus indicator is non-text UI and needs 3:1. It is drawn
    // on cards as often as on the page, so raised is the binding surface.
    expect(ratio(hex("--color-ember", scope), R)).toBeGreaterThanOrEqual(3);
    // The primary button's hover fills with ember and keeps paper-coloured type.
    expect(ratio(hex("--color-paper", scope), hex("--color-ember", scope))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every verdict colour legible as text, not just as a fill", () => {
    // #d9a441 on cream is 1.98:1 — the naive inversion's worst failure, and the
    // reason the light trio was derived from target ratios rather than mirrored.
    for (const t of ["--color-strong", "--color-mixed", "--color-weak"]) {
      expect(ratio(hex(t, scope), P)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("orders the surfaces raised > paper > sunken by luminance", () => {
    // Holds in BOTH modes: a recess that goes toward white becomes a bump, and
    // every score meter reads inside-out. --color-paper-sunken is the one surface
    // token whose direction does not invert.
    expect(lum(R)).toBeGreaterThan(lum(P));
    expect(lum(P)).toBeGreaterThan(lum(S));
  });

  it("orders the ink ramp by CONTRAST, since the hexes reverse between modes", () => {
    // On light, muted is LIGHTER than soft — the reverse of dark. Hierarchy is
    // carried by contrast, so that is what must be asserted.
    const c = (t: string) => ratio(hex(t, scope), P);
    expect(c("--color-ink")).toBeGreaterThan(c("--color-ink-soft"));
    expect(c("--color-ink-soft")).toBeGreaterThan(c("--color-ink-muted"));
  });

  it("keeps the heat ramp monotonic in contrast — more light on dark, more ink on light", () => {
    const c = (t: string) => ratio(hex(t, scope), P);
    expect(c("--color-ember-glow")).toBeGreaterThan(c("--color-ember-hot"));
    expect(c("--color-ember-hot")).toBeGreaterThan(c("--color-ember"));
  });

  it("keeps the dividers on the correct side of their surface", () => {
    // Lighter than the surface on dark, darker on light. Asserted by ratio so one
    // expectation covers both directions, and line-strong must always be further.
    expect(ratio(hex("--color-line-strong", scope), P)).toBeGreaterThan(
      ratio(hex("--color-line", scope), P),
    );
  });

  it("keeps the verdict spread ordered strong > mixed > weak", () => {
    const c = (t: string) => ratio(hex(t, scope), P);
    expect(c("--color-strong")).toBeGreaterThan(c("--color-weak"));
    expect(c("--color-mixed")).toBeGreaterThan(c("--color-weak"));
  });
});
