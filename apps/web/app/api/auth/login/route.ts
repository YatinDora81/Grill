export const runtime = "nodejs";

import { unauthorized } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { loginSchema } from "@/lib/schemas";
import * as repo from "@/lib/db/repo";
import { verifyPassword, setSessionCookie, toUserDTO } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    await rateLimit(clientKey(req, "login"), { limit: 10, windowMs: 60_000 });
    const { email, password } = loginSchema.parse(await req.json());

    const user = await repo.getUserByEmail(email);
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw unauthorized("Email or password is incorrect.", "auth");
    }
    await setSessionCookie(user.id);
    return json({ user: toUserDTO(user) });
  } catch (err) {
    return errorResponse(err);
  }
}
