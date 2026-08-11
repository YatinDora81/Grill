import "server-only";
import {
  Bar,
  Button,
  Eyebrow,
  Gap,
  Panel,
  Text,
  UrlFallback,
  esc,
  renderEmail,
  theme,
  type Palette,
} from "./layout";

const print: Palette = {
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
};

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

function verdictLine(band: string, score: number): string {
  return (
    `<h1 style="margin:0 0 10px;font-family:${theme.display};font-size:31px;font-weight:800;line-height:34px;letter-spacing:-0.015em;color:${print.ink}">` +
    `${esc(band)} &mdash; ${score}` +
    `<span style="font-size:16px;font-weight:700;color:${print.inkMuted}">/100</span>` +
    `</h1>`
  );
}

function secondaryButton(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;padding:14px 22px;border:1px solid ${print.lineStrong};font-family:${theme.sans};font-size:13px;font-weight:600;line-height:18px;color:${print.ink};text-decoration:none">${esc(label)}</a>`;
}

function renderDocument(d: Doc): string {
  return renderEmail({
    preview: `${d.band} — ${d.score}/100. ${d.headline}`,
    palette: print,
    scheme: "light",
    coil: Bar(3, print.ember),
    footnote: `Sent by grill because a report finished building on your account. ${FOOTER_LINE}`,
    body: [
      Eyebrow(d.name ? `Report ready &middot; ${esc(d.name)}` : "Report ready", print),
      verdictLine(d.band, d.score),
      Text(
        "Your interview has been scored. Here is the one thing worth fixing first.",
        "soft",
        15,
        print,
      ),
      Gap(4),
      Panel(
        `<p style="margin:0;font-family:${theme.sans};font-size:15px;line-height:24px;color:${print.inkSoft}">${esc(d.headline)}</p>`,
        print,
      ),
      Gap(24),
      Button(d.reportUrl, PRIMARY_CTA, print),
      Gap(12),
      secondaryButton(d.rematchUrl, SECONDARY_CTA),
      Gap(26),
      Text("Buttons not working? Copy this in:", "muted", 13, print),
      UrlFallback(d.reportUrl, print),
      Gap(20),
      `<p style="margin:0;font-family:${theme.mono};font-size:11px;line-height:18px;color:${print.inkMuted}">${FOOTER_LINE}</p>`,
    ].join(""),
  });
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
