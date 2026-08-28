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
    if (!user) throw notFound("User not found.", "unknown_user");

    await setSessionCookie(userId);

    return json({ user: toUserDTO(user) satisfies User });
  } catch (err) {
    return errorResponse(err);
  }
}
