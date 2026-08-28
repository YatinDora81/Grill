export const runtime = "nodejs";
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

    after(() =>
      requestPasswordReset(email).catch((err) =>
        console.error("[forgot-password] background request threw:", err),
      ),
    );

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
