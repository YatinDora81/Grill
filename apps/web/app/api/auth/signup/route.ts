export const runtime = "nodejs";

import type { User } from "@repo/types";
import { conflict } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { signupSchema } from "@/lib/schemas";
import * as repo from "@/lib/db/repo";
import { hashPassword, setSessionCookie, toUserDTO } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    await rateLimit(clientKey(req, "signup"), { limit: 8, windowMs: 60_000 });
    const { email, password, name } = signupSchema.parse(await req.json());

    if (await repo.getUserByEmail(email)) {
      throw conflict("That email's already registered. Log in instead.", "email_taken");
    }
    const passwordHash = await hashPassword(password);
    const user = await repo.createUser({ email, passwordHash, name });
    await setSessionCookie(user.id);

    return json({ user: toUserDTO(user) satisfies User });
  } catch (err) {
    return errorResponse(err);
  }
}
