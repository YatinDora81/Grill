export const runtime = "nodejs";

import { unauthorized } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import * as repo from "@/lib/db/repo";
import { getUserId, toUserDTO } from "@/lib/auth";

export async function GET() {
  try {
    const userId = await getUserId();
    if (!userId) throw unauthorized();
    const user = await repo.getUserById(userId);
    if (!user) throw unauthorized();
    return json({ user: toUserDTO(user) });
  } catch (err) {
    return errorResponse(err);
  }
}
