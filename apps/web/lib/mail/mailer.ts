import "server-only";
import { createTransport } from "nodemailer";
import { config } from "@/lib/env";
import { serviceUnavailable } from "@/lib/errors";

export interface OutboundMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function mailConfigured(): boolean {
  return config.mailConfigured;
}

let transporter: ReturnType<typeof createTransport> | null = null;

function transport(): ReturnType<typeof createTransport> {
  if (!transporter) {
    transporter = createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: config.mail.user,
        pass: config.mail.password,
      },
    });
  }
  return transporter;
}

export async function sendMail(msg: OutboundMail): Promise<void> {
  if (!mailConfigured()) {
    throw serviceUnavailable("Outbound email is not configured.", "mail_unconfigured");
  }
  await transport().sendMail({
    from: `"${config.mail.senderName}" <${config.mail.user}>`,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
}
