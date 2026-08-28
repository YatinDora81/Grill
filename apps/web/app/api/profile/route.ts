export const runtime = "nodejs";

import type { User } from "@repo/types";
import { json, errorResponse } from "@/lib/http";
import { updateProfileSchema } from "@/lib/schemas";
import { requireUserId, toUserDTO } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { notFound } from "@/lib/errors";

export async function GET() {
  try {
    const userId = await requireUserId();
    const user = await repo.getUserById(userId);
    if (!user) throw notFound("User not found.", "unknown_user");
    return json(toUserDTO(user) satisfies User);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId();
    const { name, email_on_report, timezone, email_digest } = updateProfileSchema.parse(
      await req.json(),
    );
    const user = await repo.updateUserProfile(userId, {
      name,
      emailOnReport: email_on_report,
      timezone,
      emailDigest: email_digest,
    });
    return json(toUserDTO(user) satisfies User);
  } catch (err) {
    return errorResponse(err);
  }
}
