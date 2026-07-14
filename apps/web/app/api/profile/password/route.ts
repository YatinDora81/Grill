export const runtime = "nodejs";

import { json, errorResponse } from "@/lib/http";
import { changePasswordSchema } from "@/lib/schemas";
import {
  requireUserId,
  hashPassword,
  verifyPassword,
  setSessionCookie,
} from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { badRequest, notFound, unauthorized } from "@/lib/errors";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { current_password, new_password } = changePasswordSchema.parse(await req.json());

    const user = await repo.getUserById(userId);
    if (!user) throw notFound("User not found.", "unknown_user");

    // Having the session isn't enough to change the password — an unattended
    // logged-in tab must not be able to lock the owner out of their account.
    const ok = await verifyPassword(user.passwordHash, current_password);
    if (!ok) throw unauthorized("That's not your current password.", "bad_password");

    if (current_password === new_password) {
      throw badRequest("That's the password you already have.", "password_unchanged");
    }

    await repo.updateUserPassword(userId, await hashPassword(new_password));

    // Re-issue the cookie so the JWT is minted after the change rather than
    // before it — the old one stays valid until it expires either way (these
    // are stateless tokens), but the active tab shouldn't be running on a
    // credential older than the password it belongs to.
    await setSessionCookie(userId);

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
