import "server-only";
import { config } from "@/lib/env";

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

  display: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  sans: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
} as const;

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

const PREHEADER_PAD = "‌ ".repeat(60);

const T = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';
const T_RESET = "width:100%;border-collapse:collapse";

export function Bar(height: number, color: string): string {
  return `<table ${T} style="${T_RESET}"><tr><td height="${height}" bgcolor="${color}" style="height:${height}px;font-size:1px;line-height:${height}px;background-color:${color}">&nbsp;</td></tr></table>`;
}

export function Gap(height: number): string {
  return `<div style="height:${height}px;font-size:1px;line-height:${height}px">&nbsp;</div>`;
}

export function HeatBar(height = 3): string {
  const w = (100 / HEAT.length).toFixed(3);
  const cells = HEAT.map(
    (c) =>
      `<td width="${w}%" height="${height}" bgcolor="${c}" style="width:${w}%;height:${height}px;font-size:1px;line-height:${height}px;background-color:${c}">&nbsp;</td>`,
  ).join("");
  return `<table ${T} style="${T_RESET}"><tr>${cells}</tr></table>`;
}

export function Eyebrow(html: string, p: Palette = theme): string {
  return `<p style="margin:0 0 14px;font-family:${theme.mono};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${p.ember}">${html}</p>`;
}

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
  return `<p style="margin:0 0 14px;font-family:${theme.sans};font-size:${size}px;line-height:${Math.round(size * 1.6)}px;color:${color}">${html}</p>`;
}

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

export function Chip(html: string, p: Palette = theme): string {
  return `<span style="display:inline-block;padding:6px 12px;border:1px solid ${p.lineStrong};font-family:${theme.mono};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${p.inkSoft}">${html}</span>`;
}

export function Panel(html: string, p: Palette = theme): string {
  return (
    `<table ${T} style="${T_RESET}"><tr>` +
    `<td style="padding:14px 16px;border-left:2px solid ${p.ember};background-color:${p.emberSoft}">${html}</td>` +
    `</tr></table>`
  );
}

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
    `<a href="${url}" style="display:inline-block;padding:16px 30px;background-color:${p.ember};font-family:${theme.sans};font-size:13px;font-weight:700;line-height:18px;letter-spacing:0.1em;text-transform:uppercase;color:${p.paper};text-decoration:none">${text}</a>` +
    `<!--<![endif]-->`
  );
}

export function UrlFallback(href: string, p: Palette = theme): string {
  const url = esc(href);
  return (
    `<table ${T} style="${T_RESET}"><tr>` +
    `<td style="padding:12px 14px;border:1px solid ${p.line};background-color:${p.paperSunken};font-family:${theme.mono};font-size:12px;line-height:19px;word-break:break-all">` +
    `<a href="${url}" style="color:${p.emberGlow ?? p.ember};text-decoration:none">${url}</a>` +
    `</td></tr></table>`
  );
}

export function Rule(p: Palette = theme): string {
  return Bar(1, p.line);
}

export interface EmailLayoutOptions {
  preview: string;
  body: string;
  footnote?: string;
  palette?: Palette;
  coil?: string;
  scheme?: "dark" | "light";
}

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
    `<meta name="color-scheme" content="${scheme}" />` +
    `<meta name="supported-color-schemes" content="${scheme}" />` +
    `<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->` +
    `</head>` +
    `<body style="margin:0;padding:0;width:100%;background-color:${p.paper};-webkit-text-size-adjust:100%">` +
    `<div style="display:none;overflow:hidden;max-height:0;max-width:0;opacity:0;font-size:1px;line-height:1px;color:${p.paper}">${esc(preview)}${PREHEADER_PAD}</div>` +
    `<table ${T} bgcolor="${p.paper}" style="${T_RESET};background-color:${p.paper}"><tr>` +
    `<td align="center" style="padding:36px 12px 44px">` +
    `<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table ${T} style="${T_RESET};max-width:600px">` +
    `<tr><td style="padding:0 2px 16px">` +
    `<table ${T} style="${T_RESET}"><tr>` +
    `<td align="left" style="font-family:${theme.display};font-size:23px;font-weight:700;letter-spacing:-0.02em;color:${p.ink}">` +
    `<a href="${home}" style="color:${p.ink};text-decoration:none">grill<span style="color:${p.ember}">.</span></a>` +
    `</td>` +
    `<td align="right" style="font-family:${theme.mono};font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:${p.inkMuted}">practice under heat</td>` +
    `</tr></table>` +
    `</td></tr>` +
    `<tr><td style="font-size:0;line-height:0">${coil}</td></tr>` +
    `<tr><td style="padding:30px 30px 32px;border:1px solid ${p.line};border-top:none;background-color:${p.paperRaised}">${body}</td></tr>` +
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
