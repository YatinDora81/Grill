import "server-only";
import {
  Button,
  Chip,
  Eyebrow,
  Gap,
  Heading,
  Panel,
  Text,
  UrlFallback,
  esc,
  renderEmail,
  theme,
} from "./layout";

export interface DrillDigestEmailInput {
  name: string | null;
  dueCount: number;
  streakDays: number;
  firstQuestion: string | null;
  drillUrl: string;
  profileUrl: string;
}

const FOOTER_LINE = "You can turn this weekly nudge off in Profile.";
const CTA = "Start today's drill";

function cards(n: number): string {
  return `${n} question${n === 1 ? "" : "s"}`;
}

function streakLine(streakDays: number): string {
  if (streakDays <= 0) {
    return "Your streak has ended. One drill restarts it — that is the entire cost.";
  }
  if (streakDays === 1) return "You are one day in. Day two is the one that decides it.";
  return `You are ${streakDays} days deep. Today keeps it.`;
}

export function renderDrillDigestEmail(input: DrillDigestEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { dueCount, streakDays, firstQuestion, drillUrl, profileUrl } = input;
  const first = input.name?.trim().split(/\s+/)[0];
  const question = firstQuestion?.trim() || null;

  const subject =
    streakDays > 1
      ? `${cards(dueCount)} due — and a ${streakDays}-day streak to keep`
      : `${cards(dueCount)} due in your drill`;

  return {
    subject,
    html: renderDocument({
      first: first ?? null,
      dueCount,
      streakDays,
      question,
      drillUrl,
      profileUrl,
    }),
    text: plainText({
      first: first ?? null,
      dueCount,
      streakDays,
      question,
      drillUrl,
      profileUrl,
    }),
  };
}

interface Doc {
  first: string | null;
  dueCount: number;
  streakDays: number;
  question: string | null;
  drillUrl: string;
  profileUrl: string;
}

function renderDocument(d: Doc): string {
  return renderEmail({
    preview: d.question
      ? `${cards(d.dueCount)} waiting. First one up: ${d.question}`
      : `${cards(d.dueCount)} waiting in your drill.`,
    footnote:
      `Sent weekly by grill because you have drill cards due. ` +
      `<a href="${esc(d.profileUrl)}" style="color:${theme.inkSoft};text-decoration:underline">Turn it off in Profile</a>.`,
    body: [
      Eyebrow("Daily drill &middot; your deck"),
      Heading(
        d.dueCount === 1
          ? "One question<br />wants another go."
          : `${d.dueCount} questions<br />want another go.`,
      ),
      Text(d.first ? `Hi ${esc(d.first)},` : "Hi,", "ink"),
      Text(
        "These are the questions you answered badly, coming back on schedule. " +
          "A drill is one question, spoken or typed, in about a minute — no interview, no report.",
      ),
      Gap(6),
      Chip(`&#128293; ${streakLine(d.streakDays)}`),
      Gap(22),
      d.question
        ? Panel(
            `<p style="margin:0 0 6px;font-family:${theme.mono};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${theme.inkMuted}">First one up</p>` +
              `<p style="margin:0;font-family:${theme.sans};font-size:16px;line-height:25px;color:${theme.ink}">${esc(d.question)}</p>`,
          )
        : "",
      Gap(24),
      Button(d.drillUrl, CTA),
      Gap(24),
      Text("Button not working? Copy this in:", "muted", 13),
      UrlFallback(d.drillUrl),
      Gap(20),
      `<p style="margin:0;font-family:${theme.mono};font-size:11px;line-height:18px;color:${theme.inkMuted}">${FOOTER_LINE}</p>`,
    ].join(""),
  });
}

function plainText(d: Doc): string {
  return [
    "GRILL — practice under heat",
    "===========================",
    "",
    d.first ? `Hi ${d.first},` : "Hi,",
    "",
    `${cards(d.dueCount).toUpperCase()} DUE IN YOUR DRILL`,
    "",
    streakLine(d.streakDays),
    "",
    ...(d.question ? ["First one up:", `  ${d.question}`, ""] : []),
    "A drill is one question, spoken or typed, in about a minute.",
    "No interview, no report.",
    "",
    `${CTA}:`,
    d.drillUrl,
    "",
    FOOTER_LINE,
    d.profileUrl,
    "",
    "— grill",
  ].join("\n");
}
