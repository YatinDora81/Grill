import "server-only";
/**
 * The shell every Grill email sits in.
 *
 * ── Why strings and not JSX ─────────────────────────────────────────────────
 * This module is only ever reached from an App Router route handler, and Next
 * compiles every `app/` entry — route handlers included — in the React Server
 * Components layer. Under that layer's `react-server` export condition,
 * `react-dom/server` resolves to a file whose entire body is
 * `throw new Error("react-dom/server is not supported in React Server
 * Components.")`. So `renderToStaticMarkup` cannot run here at all: the flow
 * would 500 on the first registered address it was given, in production and in
 * dev alike. `react-dom/server.edge` and `react-dom/static` are aliased to the
 * same dead end for this layer, so they are not an escape either.
 *
 * The one thing JSX was buying us was automatic escaping of interpolated values,
 * and that is bought back explicitly by `esc` below. Every function here returns
 * a trusted HTML string; anything originating from a user or a URL must be run
 * through `esc` at the point it enters.
 *
 * server-only: `config` and the reset link have no business in a browser bundle,
 * and nothing here is ever rendered as a page.
 *
 * ── This is not a web page ──────────────────────────────────────────────────
 * Gmail strips <style> blocks, classes, CSS variables, flex, grid and
 * background-image. Outlook on Windows renders through Word, which additionally
 * ignores max-width, border-radius and padding on anchors. So: every rule is
 * inline, every layout is a table, every gradient is a row of solid-filled cells,
 * and the one button is wrapped in a VML fallback.
 *
 * The palette is a hand-copy of the @theme tokens in `app/globals.css` — the one
 * place in the codebase a token may be re-typed as a literal, because there is no
 * cascade to read it from. If the tokens move, move these with them.
 */
import { config } from "@/lib/env";

/**
 * HTML-escape a value on its way into the document.
 *
 * Both quote forms are escaped, not just `<` and `&`: these strings are also
 * interpolated into `href="…"` and `style="…"` attributes, where a bare quote
 * ends the attribute and everything after it becomes markup we didn't write.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface Palette {
  paper: string;
  paperRaised: string;
  paperSunken: string;
  ink: string;
  inkSoft: string;
  inkMuted: string;
  line: string;
  lineStrong: string;
  ember: string;
  emberSoft: string;
  emberGlow?: string;
}

/** Mirrors the `@theme` block in app/globals.css. Keep in sync by hand. */
export const theme = {
  paper: "#0e0e0e",
  paperRaised: "#131313",
  paperSunken: "#0a0a0a",
  ink: "#e9e6df",
  inkSoft: "#9b978e",
  inkMuted: "#75736c",
  line: "#262521",
  lineStrong: "#3a3833",
  ember: "#ff4633",
  emberHot: "#ff6a5a",
  emberGlow: "#ff8a72",
  emberSoft: "#2a1512",

  /**
   * Archivo and Geist are webfonts; email clients that load remote fonts at all
   * are the minority, so both fall back to something universally installed.
   * Arial-first for the display face rather than a serif: the app sets every
   * headline in a heavy uppercase grotesque, and Georgia would arrive as a
   * different brand. Arial sits in every stack because Outlook's Word engine
   * drops to Times New Roman on a family it cannot match.
   */
  display: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  sans: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
} as const;

/**
 * The heat ramp, as discrete stops.
 *
 * The product's signature is a coil coming up to temperature, and in the app
 * that's a CSS gradient. A gradient is a background-image, which Outlook drops
 * and several webmail clients rewrite — so this is painted as a row of
 * solid-filled table cells instead. Thirteen stops is enough that it reads as a
 * continuous burn at the 3px height it's used at, and a solid `bgcolor` is the
 * single most portable thing in email: there is no client that fails to render
 * it.
 */
const HEAT = [
  "#2a1512",
  "#451a17",
  "#60201c",
  "#7b2621",
  "#962c26",
  "#b1332b",
  "#cc3930",
  "#e73f31",
  "#ff4633",
  "#ff5642",
  "#ff6a5a",
  "#ff7a66",
  "#ff8a72",
] as const;

/**
 * Trailing filler for the preheader. Zero-width non-joiners and non-breaking
 * spaces push the first line of real body copy out of the inbox preview, which
 * otherwise reads "…expires in 60 minutes Reset your password Hi Sam".
 */
const PREHEADER_PAD = "‌ ".repeat(60);

/** Table attributes every layout table needs, so none of them can drift. */
const T = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';
const T_RESET = "width:100%;border-collapse:collapse";

/** A filled row of a given height — the portable way to draw a bar or a gap. */
export function Bar(height: number, color: string): string {
  return `<table ${T} style="${T_RESET}"><tr><td height="${height}" bgcolor="${color}" style="height:${height}px;font-size:1px;line-height:${height}px;background-color:${color}">&nbsp;</td></tr></table>`;
}

/** Vertical space. A cell, not a margin — Outlook collapses margins unpredictably. */
export function Gap(height: number): string {
  return `<div style="height:${height}px;font-size:1px;line-height:${height}px">&nbsp;</div>`;
}

/**
 * The coil, coming up to heat. The one piece of pure identity in the mail.
 *
 * Percentage widths rather than fixed: the card is fluid down to phone width, and
 * a fixed-width ramp would either overflow it or leave a gap at the end.
 */
export function HeatBar(height = 3): string {
  const w = (100 / HEAT.length).toFixed(3);
  const cells = HEAT.map(
    (c) =>
      `<td width="${w}%" height="${height}" bgcolor="${c}" style="width:${w}%;height:${height}px;font-size:1px;line-height:${height}px;background-color:${c}">&nbsp;</td>`,
  ).join("");
  return `<table ${T} style="${T_RESET}"><tr>${cells}</tr></table>`;
}

/** Small mono uppercase label — the same one the app puts above every section. */
export function Eyebrow(html: string, p: Palette = theme): string {
  return `<p style="margin:0 0 14px;font-family:${theme.mono};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${p.ember}">${html}</p>`;
}

/**
 * Heavy uppercase, tight — the app sets every headline this way and an email in
 * sentence case would arrive looking like it came from somewhere else.
 *
 * `letter-spacing` stays slightly negative even at these caps: Arial's uppercase
 * is loose by default, and without the pull the line reads as a banner rather
 * than as a headline.
 */
export function Heading(html: string, p: Palette = theme): string {
  return `<h1 style="margin:0 0 16px;font-family:${theme.display};font-size:31px;font-weight:800;line-height:33px;letter-spacing:-0.015em;text-transform:uppercase;color:${p.ink}">${html}</h1>`;
}

export function Text(
  html: string,
  tone: "ink" | "soft" | "muted" = "soft",
  size = 15,
  p: Palette = theme,
): string {
  const color = tone === "ink" ? p.ink : tone === "muted" ? p.inkMuted : p.inkSoft;
  // An explicit px line-height, not a unitless ratio: Outlook resolves unitless
  // line-heights against its own default font size, not ours.
  return `<p style="margin:0 0 14px;font-family:${theme.sans};font-size:${size}px;line-height:${Math.round(size * 1.6)}px;color:${color}">${html}</p>`;
}

/**
 * A numbered step, in the shell rail's idiom — `01 / 02 / 03` in mono ember
 * against the label. The app teaches the whole product as a numbered sequence;
 * the mail that pulls someone back into it should read the same way.
 */
export function Steps(items: string[], p: Palette = theme): string {
  const rows = items
    .map((label, i) => {
      const n = String(i + 1).padStart(2, "0");
      const pad = i === 0 ? "0" : "9px";
      return (
        `<tr>` +
        `<td width="30" valign="top" style="width:30px;padding:${pad} 0 0;font-family:${theme.mono};font-size:11px;line-height:21px;color:${p.ember}">${n}</td>` +
        `<td valign="top" style="padding:${pad} 0 0;font-family:${theme.sans};font-size:14px;line-height:21px;color:${p.inkSoft}">${label}</td>` +
        `</tr>`
      );
    })
    .join("");
  return `<table ${T} style="${T_RESET}">${rows}</table>`;
}

/**
 * A mono pill — the app's `.chip`. Used for the one fact people scan for before
 * they read anything else: how long this link has left.
 */
export function Chip(html: string, p: Palette = theme): string {
  return `<span style="display:inline-block;padding:6px 12px;border:1px solid ${p.lineStrong};font-family:${theme.mono};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${p.inkSoft}">${html}</span>`;
}

/**
 * An aside with the ember left-edge the app puts on anything that needs reading
 * before it's acted on (`.resume`, the dashboard readout).
 */
export function Panel(html: string, p: Palette = theme): string {
  return (
    `<table ${T} style="${T_RESET}"><tr>` +
    `<td style="padding:14px 16px;border-left:2px solid ${p.ember};background-color:${p.emberSoft}">${html}</td>` +
    `</tr></table>`
  );
}

/**
 * The one primary action.
 *
 * Two renderings of the same button, selected by conditional comment. Outlook on
 * Windows lays out through Word, which ignores `border-radius` and won't apply
 * `padding` to an inline anchor — the ember button would arrive as a bare orange
 * word. The VML `roundrect` is the standard answer: a vector rectangle Word does
 * understand, sized in points, with the label centred inside it.
 *
 * Everything else gets the real anchor. Always print the raw URL near it (see
 * `UrlFallback`): a fair number of clients render the anchor but never linkify
 * it.
 */
export function Button(href: string, label: string, p: Palette = theme): string {
  const url = esc(href);
  const text = esc(label);
  return (
    `<!--[if mso]>` +
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:50px;v-text-anchor:middle;width:280px;" arcsize="0%" stroke="f" fillcolor="${p.ember}">` +
    `<w:anchorlock/>` +
    `<center style="color:${p.paper};font-family:Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:0.1em;">${text.toUpperCase()}</center>` +
    `</v:roundrect>` +
    `<![endif]-->` +
    `<!--[if !mso]><!-->` +
    // `color` is restated even though it's on the parent: several clients force
    // their own link colour onto any <a> that doesn't set one.
    `<a href="${url}" style="display:inline-block;padding:16px 30px;background-color:${p.ember};font-family:${theme.sans};font-size:13px;font-weight:700;line-height:18px;letter-spacing:0.1em;text-transform:uppercase;color:${p.paper};text-decoration:none">${text}</a>` +
    `<!--<![endif]-->`
  );
}

/**
 * The same link as plain text, in a sunken box so it reads as something to copy
 * rather than something to read.
 */
export function UrlFallback(href: string, p: Palette = theme): string {
  const url = esc(href);
  return (
    `<table ${T} style="${T_RESET}"><tr>` +
    // A reset URL is longer than 600px of Georgia; without `word-break` it either
    // forces the whole table wider than the viewport or gets clipped.
    `<td style="padding:12px 14px;border:1px solid ${p.line};background-color:${p.paperSunken};font-family:${theme.mono};font-size:12px;line-height:19px;word-break:break-all">` +
    `<a href="${url}" style="color:${p.emberGlow ?? p.ember};text-decoration:none">${url}</a>` +
    `</td></tr></table>`
  );
}

/** A hairline rule. A filled 1px row, because <hr> is styled differently everywhere. */
export function Rule(p: Palette = theme): string {
  return Bar(1, p.line);
}

export interface EmailLayoutOptions {
  /** Preheader: the line inboxes show next to the subject. Never rendered visibly. */
  preview: string;
  /** The card's contents, already composed from the helpers above. */
  body: string;
  /** Footer fine print. Defaults to the "wasn't you? ignore it" line. */
  footnote?: string;
  palette?: Palette;
  coil?: string;
  scheme?: "dark" | "light";
}

/**
 * Wrap composed body HTML in the full document.
 *
 * The XHTML doctype is the email convention — Word's rendering engine behaves
 * more predictably with it than with the HTML5 one — and the `xmlns:v` / `xmlns:o`
 * namespaces on <html> are what make the VML button above legal markup to it.
 */
export function renderEmail({
  preview,
  body,
  footnote,
  palette: p = theme,
  coil = HeatBar(3),
  scheme = "dark",
}: EmailLayoutOptions): string {
  const home = esc(config.site.url);
  const defaultFootnote =
    `You&rsquo;re getting this because this address was entered at ` +
    `<a href="${home}" style="color:${p.inkSoft};text-decoration:underline">grill</a>. ` +
    `If that wasn&rsquo;t you, nothing has happened to any account and you can ignore this email.`;

  return (
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ' +
    '"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">' +
    `<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">` +
    `<head>` +
    `<meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    // Grill is a dark room by design. Without these, Gmail and Outlook dark mode
    // "helpfully" invert the palette — which lands cream text on a near-white
    // card and turns the ember into a muddy blue.
    `<meta name="color-scheme" content="${scheme}" />` +
    `<meta name="supported-color-schemes" content="${scheme}" />` +
    // Word renders at 96dpi only if told to; without this the VML button and all
    // the pixel paddings come out about a third too large on Outlook/Windows.
    `<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->` +
    `</head>` +
    `<body style="margin:0;padding:0;width:100%;background-color:${p.paper};-webkit-text-size-adjust:100%">` +
    `<div style="display:none;overflow:hidden;max-height:0;max-width:0;opacity:0;font-size:1px;line-height:1px;color:${p.paper}">${esc(preview)}${PREHEADER_PAD}</div>` +
    // The page background is set on this table as well as on <body>: several
    // webmail clients drop the <body> element entirely and re-host the markup
    // inside their own, taking our background with it — which would leave
    // cream-on-white and an unreadable email.
    `<table ${T} bgcolor="${p.paper}" style="${T_RESET};background-color:${p.paper}"><tr>` +
    `<td align="center" style="padding:36px 12px 44px">` +
    // Outlook ignores max-width and would render the column at window width, so
    // it gets a real 600px table via conditional comment. Everyone else takes the
    // fluid one underneath and stays readable on a phone.
    `<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table ${T} style="${T_RESET};max-width:600px">` +
    // ── masthead ──────────────────────────────────────────────────────────
    `<tr><td style="padding:0 2px 16px">` +
    `<table ${T} style="${T_RESET}"><tr>` +
    `<td align="left" style="font-family:${theme.display};font-size:23px;font-weight:700;letter-spacing:-0.02em;color:${p.ink}">` +
    `<a href="${home}" style="color:${p.ink};text-decoration:none">grill<span style="color:${p.ember}">.</span></a>` +
    `</td>` +
    `<td align="right" style="font-family:${theme.mono};font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:${p.inkMuted}">practice under heat</td>` +
    `</tr></table>` +
    `</td></tr>` +
    // ── the coil, then the card ───────────────────────────────────────────
    `<tr><td style="font-size:0;line-height:0">${coil}</td></tr>` +
    `<tr><td style="padding:30px 30px 32px;border:1px solid ${p.line};border-top:none;background-color:${p.paperRaised}">${body}</td></tr>` +
    // ── footer ────────────────────────────────────────────────────────────
    `<tr><td style="padding:26px 2px 0">${Rule(p)}</td></tr>` +
    `<tr><td style="padding:14px 2px 0">` +
    `<p style="margin:0;font-family:${theme.sans};font-size:12px;line-height:19px;color:${p.inkMuted}">${footnote ?? defaultFootnote}</p>` +
    `</td></tr>` +
    `</table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table>` +
    `</body></html>`
  );
}
