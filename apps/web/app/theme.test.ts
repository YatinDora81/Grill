import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { DARK_PAPER, LIGHT_PAPER, resolveTheme } from "@/components/theme";

const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function blocks(sel: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = CSS.indexOf(sel, from);
    if (at === -1) break;
    from = at + sel.length;
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
    expect(DARK.get("--color-paper")).toBe(DARK_PAPER);
    expect(LIGHT.get("--color-paper")).toBe(LIGHT_PAPER);
  });

  it("leaves dark reachable with no attribute at all, for a JS-off reader", () => {
    expect(DARK.get("--color-paper")).toBeDefined();
    expect(CSS).toMatch(/:root\s*\{\s*color-scheme:\s*dark/);
  });
});

describe("the room pin", () => {
  it("re-declares every token the light block overrides", () => {
    const missing = [...LIGHT.keys()].filter((k) => !PIN.has(k));
    expect(missing).toEqual([]);
  });

  it("re-declares every token whose value bakes in another token", () => {
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
    expect(ratio(hex("--color-ember", scope), R)).toBeGreaterThanOrEqual(3);
    expect(ratio(hex("--color-paper", scope), hex("--color-ember", scope))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every verdict colour legible as text, not just as a fill", () => {
    for (const t of ["--color-strong", "--color-mixed", "--color-weak"]) {
      expect(ratio(hex(t, scope), P)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("orders the surfaces raised > paper > sunken by luminance", () => {
    expect(lum(R)).toBeGreaterThan(lum(P));
    expect(lum(P)).toBeGreaterThan(lum(S));
  });

  it("orders the ink ramp by CONTRAST, since the hexes reverse between modes", () => {
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
