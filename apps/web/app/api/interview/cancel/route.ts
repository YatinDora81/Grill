export const runtime = "nodejs";

import type { CancelResponse } from "@repo/types";
import { conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { sessionIdSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { session_id } = sessionIdSchema.parse(await req.json());
    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");
    if (session.status !== "in_progress") {
      throw conflict(`Cannot cancel a ${session.status} session.`, "not_cancellable");
    }
    await repo.setStatus(session_id, "cancelled");
    return json({ session_id, status: "cancelled" } satisfies CancelResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
