export const runtime = "nodejs";

import type { User } from "@repo/types";
import { notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { resetPasswordSchema } from "@/lib/schemas";
import * as repo from "@/lib/db/repo";
import { setSessionCookie, toUserDTO } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { resetPassword } from "@/lib/services/passwordResetService";

export async function POST(req: Request) {
  try {
    rateLimit(clientKey(req, "reset-password"), { limit: 10, windowMs: 15 * 60_000 });
    const { token, password } = resetPasswordSchema.parse(await req.json());

    const userId = await resetPassword(token, password);
    const user = await repo.getUserById(userId);
    // The account went away between the token being issued and redeemed. Rare,
    // but the alternative is minting a session cookie for a user who no longer
    // exists, which getUserId() would then reject on every subsequent request.
    if (!user) throw notFound("User not found.", "unknown_user");

    // Signing them straight in adds no risk: whoever held that token could set
    // the password and log in with it anyway. It just saves a pointless second
    // trip through the login form.
    await setSessionCookie(userId);

    // Same body as login and signup so the client can treat all three alike.
    return json({ user: toUserDTO(user) satisfies User });
  } catch (err) {
    return errorResponse(err);
  }
}
