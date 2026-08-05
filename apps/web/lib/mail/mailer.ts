import "server-only";
/**
 * Outbound mail (Grill §Accounts & auth). Gmail SMTP, implicit TLS on 465.
 *
 * Port 465 rather than 587: the connection is encrypted before the first byte
 * of the login, so a misconfigured server can't downgrade us into sending the
 * credentials in the clear the way a failed STARTTLS on 587 can.
 */
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

/**
 * Built on first send, not at import time. `mailer` is reachable from the auth
 * routes, so building at import would open a TCP/TLS pool for every request
 * that merely touches that import graph — and would throw at module scope on a
 * deployment with no mail configured, taking down routes that never send.
 */
function transport(): ReturnType<typeof createTransport> {
  if (!transporter) {
    transporter = createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: config.mail.user,
        // Google rejects the plain account password here with a bare
        // "Username and Password not accepted" — this must be an App Password.
        // It is the single most common way this integration is misconfigured.
        pass: config.mail.password,
      },
    });
  }
  return transporter;
}

/**
 * Hands a message to Gmail.
 *
 * Resolving means the SMTP server ACCEPTED the message, not that it landed in
 * anyone's inbox — a bounce or a spam verdict happens later and out of band, so
 * nothing downstream may treat this as proof of delivery.
 *
 * Throws when mail is unconfigured instead of quietly doing nothing: a send
 * that silently evaporates is how a broken reset flow passes every smoke test
 * in production. The caller decides how to degrade (the forgot-password route
 * has to answer 200 either way); it cannot decide if it isn't told.
 */
export async function sendMail(msg: OutboundMail): Promise<void> {
  if (!mailConfigured()) {
    throw serviceUnavailable("Outbound email is not configured.", "mail_unconfigured");
  }
  await transport().sendMail({
    // Gmail rewrites the address to the authenticated account anyway, so the
    // only part we actually control is the display name.
    from: `"${config.mail.senderName}" <${config.mail.user}>`,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    // Both bodies, always: a message with no text/plain part scores worse with
    // every spam filter, and is unreadable in a terminal client.
    text: msg.text,
  });
}
