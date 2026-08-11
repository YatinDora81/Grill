import "server-only";
import { Gap, esc, theme } from "./layout";
import { config } from "@/lib/env";

const print = {
  paper: "#f4f0e6",
  paperRaised: "#fdfbf6",
  paperSunken: "#ece7da",
  ink: "#17140e",
  inkSoft: "#535045",
  inkMuted: "#6b6759",
  line: "#d7d0be",
  lineStrong: "#9d9787",
  ember: "#bf2b10",
  emberSoft: "#f7e2da",
} as const;

export interface ReportReadyEmailInput {
  sessionName: string | null;
  score: number;
  band: string;
  headline: string;
  reportUrl: string;
  rematchUrl: string;
}

const SUBJECT_PREFIX = "Your verdict is ready";
const FOOTER_LINE = "You can turn these off in Profile.";
const PRIMARY_CTA = "Read the full report";
const SECONDARY_CTA = "Run the weak-spots rematch";

const T = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';
const T_RESET = "width:100%;border-collapse:collapse";

const PREHEADER_PAD = "‌ ".repeat(60);

export function renderReportReadyEmail(input: ReportReadyEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const doc: Doc = {
    name: input.sessionName?.trim() || null,
    score: input.score,
    band: input.band,
    headline: input.headline,
    reportUrl: input.reportUrl,
    rematchUrl: input.rematchUrl,
  };

  return {
    subject: `${SUBJECT_PREFIX} — ${doc.score}/100, ${doc.band}`,
    html: renderDocument(doc),
    text: plainText(doc),
  };
}

interface Doc {
  name: string | null;
  score: number;
  band: string;
  headline: string;
  reportUrl: string;
  rematchUrl: string;
}

function rule(height: number, color: string): string {
  return `<table ${T} style="${T_RESET}"><tr><td height="${height}" bgcolor="${color}" style="height:${height}px;font-size:1px;line-height:${height}px;background-color:${color}">&nbsp;</td></tr></table>`;
}

function eyebrow(html: string): string {
  return `<p style="margin:0 0 14px;font-family:${theme.mono};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${print.ember}">${html}</p>`;
}

function verdictLine(band: string, score: number): string {
  return (
    `<h1 style="margin:0 0 10px;font-family:${theme.display};font-size:31px;font-weight:800;line-height:34px;letter-spacing:-0.015em;color:${print.ink}">` +
    `${esc(band)} &mdash; ${score}` +
    `<span style="font-size:16px;font-weight:700;color:${print.inkMuted}">/100</span>` +
    `</h1>`
  );
}

function body(html: string, tone: "ink" | "soft" | "muted" = "soft", size = 15): string {
  const color = tone === "ink" ? print.ink : tone === "muted" ? print.inkMuted : print.inkSoft;
  return `<p style="margin:0 0 14px;font-family:${theme.sans};font-size:${size}px;line-height:${Math.round(size * 1.6)}px;color:${color}">${html}</p>`;
}

function headlinePanel(html: string): string {
  return (
    `<table ${T} style="${T_RESET}"><tr>` +
    `<td style="padding:14px 16px;border-left:2px solid ${print.ember};background-color:${print.emberSoft}">` +
    `<p style="margin:0;font-family:${theme.sans};font-size:15px;line-height:24px;color:${print.inkSoft}">${html}</p>` +
    `</td></tr></table>`
  );
}

function primaryButton(href: string, label: string): string {
  const url = esc(href);
  const text = esc(label);
  return (
    `<!--[if mso]>` +
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:50px;v-text-anchor:middle;width:280px;" arcsize="0%" stroke="f" fillcolor="${print.ember}">` +
    `<w:anchorlock/>` +
    `<center style="color:${print.paper};font-family:Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:0.1em;">${text.toUpperCase()}</center>` +
    `</v:roundrect>` +
    `<![endif]-->` +
    `<!--[if !mso]><!-->` +
    `<a href="${url}" style="display:inline-block;padding:16px 30px;background-color:${print.ember};font-family:${theme.sans};font-size:13px;font-weight:700;line-height:18px;letter-spacing:0.1em;text-transform:uppercase;color:${print.paper};text-decoration:none">${text}</a>` +
    `<!--<![endif]-->`
  );
}

function secondaryButton(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;padding:14px 22px;border:1px solid ${print.lineStrong};font-family:${theme.sans};font-size:13px;font-weight:600;line-height:18px;color:${print.ink};text-decoration:none">${esc(label)}</a>`;
}

function urlFallback(href: string): string {
  const url = esc(href);
  return (
    `<table ${T} style="${T_RESET}"><tr>` +
    `<td style="padding:12px 14px;border:1px solid ${print.line};background-color:${print.paperSunken};font-family:${theme.mono};font-size:12px;line-height:19px;word-break:break-all">` +
    `<a href="${url}" style="color:${print.ember};text-decoration:none">${url}</a>` +
    `</td></tr></table>`
  );
}

function renderDocument(d: Doc): string {
  const home = esc(config.site.url);
  const preview = `${d.band} — ${d.score}/100. ${d.headline}`;

  const card = [
    eyebrow(d.name ? `Report ready &middot; ${esc(d.name)}` : "Report ready"),
    verdictLine(d.band, d.score),
    body("Your interview has been scored. Here is the one thing worth fixing first."),
    Gap(4),
    headlinePanel(esc(d.headline)),
    Gap(24),
    primaryButton(d.reportUrl, PRIMARY_CTA),
    Gap(12),
    secondaryButton(d.rematchUrl, SECONDARY_CTA),
    Gap(26),
    body("Buttons not working? Copy this in:", "muted", 13),
    urlFallback(d.reportUrl),
    Gap(20),
    `<p style="margin:0;font-family:${theme.mono};font-size:11px;line-height:18px;color:${print.inkMuted}">${FOOTER_LINE}</p>`,
  ].join("");

  return (
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ' +
    '"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">' +
    `<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">` +
    `<head>` +
    `<meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<meta name="color-scheme" content="light" />` +
    `<meta name="supported-color-schemes" content="light" />` +
    `<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->` +
    `</head>` +
    `<body style="margin:0;padding:0;width:100%;background-color:${print.paper};-webkit-text-size-adjust:100%">` +
    `<div style="display:none;overflow:hidden;max-height:0;max-width:0;opacity:0;font-size:1px;line-height:1px;color:${print.paper}">${esc(preview)}${PREHEADER_PAD}</div>` +
    `<table ${T} bgcolor="${print.paper}" style="${T_RESET};background-color:${print.paper}"><tr>` +
    `<td align="center" style="padding:36px 12px 44px">` +
    `<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table ${T} style="${T_RESET};max-width:600px">` +
    `<tr><td style="padding:0 2px 16px">` +
    `<table ${T} style="${T_RESET}"><tr>` +
    `<td align="left" style="font-family:${theme.display};font-size:23px;font-weight:700;letter-spacing:-0.02em;color:${print.ink}">` +
    `<a href="${home}" style="color:${print.ink};text-decoration:none">grill<span style="color:${print.ember}">.</span></a>` +
    `</td>` +
    `<td align="right" style="font-family:${theme.mono};font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:${print.inkMuted}">practice under heat</td>` +
    `</tr></table>` +
    `</td></tr>` +
    `<tr><td style="font-size:0;line-height:0">${rule(3, print.ember)}</td></tr>` +
    `<tr><td style="padding:30px 30px 32px;border:1px solid ${print.line};border-top:none;background-color:${print.paperRaised}">${card}</td></tr>` +
    `<tr><td style="padding:26px 2px 0">${rule(1, print.line)}</td></tr>` +
    `<tr><td style="padding:14px 2px 0">` +
    `<p style="margin:0;font-family:${theme.sans};font-size:12px;line-height:19px;color:${print.inkMuted}">` +
    `Sent by grill because a report finished building on your account. ${FOOTER_LINE}` +
    `</p>` +
    `</td></tr>` +
    `</table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

function plainText(d: Doc): string {
  return [
    "GRILL — practice under heat",
    "===========================",
    "",
    d.name ? `REPORT READY — ${d.name}` : "REPORT READY",
    "",
    `${d.band} — ${d.score}/100`,
    "",
    d.headline,
    "",
    `${PRIMARY_CTA}:`,
    d.reportUrl,
    "",
    `${SECONDARY_CTA}:`,
    d.rematchUrl,
    "",
    FOOTER_LINE,
    "",
    "— grill",
  ].join("\n");
}
