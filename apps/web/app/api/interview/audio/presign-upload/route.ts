export const runtime = "nodejs";

import { notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { turnRefSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { audioKey, presignPut } from "@/lib/storage/objectStore";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { session_id, turn_index } = turnRefSchema.parse(await req.json());

    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");

    const key = audioKey(session_id, turn_index);
    const url = await presignPut(key);
    return json({ url, key });
  } catch (err) {
    return errorResponse(err);
  }
}
