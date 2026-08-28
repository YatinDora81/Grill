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

    const ok = await verifyPassword(user.passwordHash, current_password);
    if (!ok) throw unauthorized("That's not your current password.", "bad_password");

    if (current_password === new_password) {
      throw badRequest("That's the password you already have.", "password_unchanged");
    }

    await repo.updateUserPassword(userId, await hashPassword(new_password));

    await setSessionCookie(userId);

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
