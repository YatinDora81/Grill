export const runtime = "nodejs";
// The SMTP handshake happens in `after()`, after the response has flushed, but
// still inside this invocation's budget — so the function has to stay alive long
// enough for a slow mail server. Same reasoning as /api/interview/end.
export const maxDuration = 60;

import { after } from "next/server";
import { json, errorResponse } from "@/lib/http";
import { forgotPasswordSchema } from "@/lib/schemas";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { requestPasswordReset } from "@/lib/services/passwordResetService";

export async function POST(req: Request) {
  try {
    // Tighter than login: each accepted request sends real mail to an address
    // the caller chose, so an unthrottled endpoint is a spam cannon as well as
    // an enumeration tool.
    rateLimit(clientKey(req, "forgot-password"), { limit: 5, windowMs: 15 * 60_000 });
    const { email } = forgotPasswordSchema.parse(await req.json());

    /**
     * Deliberately NOT awaited before responding.
     *
     * An identical body and status is only half of not being an enumeration
     * oracle — the other half is time. An unknown address returns after a single
     * indexed SELECT; a registered one writes a row, renders a document and
     * opens a TLS connection to Gmail. That is milliseconds against seconds, and
     * two requests are enough to tell them apart. Running the work after the
     * response flushes makes both answers arrive on the same schedule.
     *
     * `requestPasswordReset` swallows its own failures, so the `.catch` here is
     * for the genuinely unexpected — an unhandled rejection inside `after()`
     * would otherwise take the whole invocation down after the fact.
     */
    after(() =>
      requestPasswordReset(email).catch((err) =>
        console.error("[forgot-password] background request threw:", err),
      ),
    );

    // The same 200 whether or not that address is registered, and whether or not
    // the mail actually went out. Any other answer turns this route into an
    // account-enumeration oracle, which is the one thing it must never be.
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
