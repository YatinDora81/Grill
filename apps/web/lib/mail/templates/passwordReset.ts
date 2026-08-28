import "server-only";
import {
  Button,
  Chip,
  Eyebrow,
  Gap,
  Heading,
  Panel,
  Steps,
  Text,
  UrlFallback,
  esc,
  renderEmail,
  theme,
} from "./layout";

export interface PasswordResetEmailInput {
  name: string | null;
  resetUrl: string;
  expiresInMinutes: number;
}

const SUBJECT = "Reset your grill password";

function minutes(n: number): string {
  return `${n} ${n === 1 ? "minute" : "minutes"}`;
}

export function renderPasswordResetEmail(input: PasswordResetEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { name, resetUrl, expiresInMinutes } = input;
  const first = name?.trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${esc(first)},` : "Hi,";
  const validFor = minutes(expiresInMinutes);

  const html = renderDocument(greeting, resetUrl, validFor);
  const textGreeting = first ? `Hi ${first},` : "Hi,";
  return { subject: SUBJECT, html, text: plainText(textGreeting, resetUrl, validFor) };
}

function renderDocument(greeting: string, resetUrl: string, validFor: string): string {
  return renderEmail({
    preview: `One link back into the room — it works once and expires in ${validFor}.`,
    footnote:
      "Sent by grill because a password reset was requested for this address. " +
      "We will never ask you for your password by email.",
    body: [
      Eyebrow("Account &middot; password reset"),
      Heading("Let&rsquo;s get you back<br />in the room."),
      Text(greeting, "ink"),
      Text(
        "Someone asked to reset the password on your grill account. If that was you, the button " +
          "below sets a new one and puts you straight back on the dashboard.",
      ),

      Gap(6),
      Steps([
        "Open the link — it only opens for you, once.",
        "Pick a password you&rsquo;ll actually remember.",
        "You&rsquo;re signed in on that device the moment it saves.",
      ]),
      Gap(24),

      Button(resetUrl, "Set a new password"),
      Gap(16),
      Chip(`&#9201; Expires in ${validFor} &middot; one use`),
      Gap(24),

      Text("Button not working? Copy this in:", "muted", 13),
      UrlFallback(resetUrl),
      Gap(22),

      Panel(
        `<p style="margin:0;font-family:${theme.sans};font-size:13px;line-height:21px;color:${theme.inkSoft}">` +
          `<strong style="color:${theme.ink}">Didn&rsquo;t ask for this?</strong> Then nothing has ` +
          `happened. Your current password still works, nobody has been let in, and this link ` +
          `dies on its own in ${validFor}. You can delete this email.` +
          `</p>`,
      ),
    ].join(""),
  });
}

function plainText(greeting: string, resetUrl: string, validFor: string): string {
  return [
    "GRILL — practice under heat",
    "===========================",
    "",
    greeting,
    "",
    "Someone asked to reset the password on your grill account.",
    "If that was you, open the link below and set a new one:",
    "",
    resetUrl,
    "",
    `It expires in ${validFor} and can only be used once. The moment the`,
    "new password saves, you're signed in on that device.",
    "",
    "DIDN'T ASK FOR THIS?",
    "Then nothing has happened. Your current password still works,",
    "nobody has been let in, and the link above dies on its own.",
    "You can delete this email.",
    "",
    "We will never ask you for your password by email.",
    "",
    "— grill",
  ].join("\n");
}
