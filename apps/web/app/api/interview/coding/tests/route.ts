export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { CodingExample } from "@repo/types";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { codingTestsQuerySchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/db/repo";
import { payloadOf } from "@/lib/services/codingService";

export interface CodingTestsResponse {
  hidden_tests: CodingExample[];
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`coding-tests:${userId}`, { limit: 60, windowMs: 60_000 });

    const url = new URL(req.url);
    const { session_id, turn_index } = codingTestsQuerySchema.parse({
      session_id: url.searchParams.get("session_id"),
      turn_index: url.searchParams.get("turn_index"),
    });

    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");
    if (session.status !== "in_progress") {
      throw conflict(`Session is ${session.status}, not accepting answers.`, "session_not_active");
    }

    const turn = await repo.getTurn(session_id, turn_index);
    if (!turn) throw badRequest(`No question at turn_index ${turn_index}.`, "unknown_turn");
    if (turn.transcript) {
      throw conflict(`Turn ${turn_index} was already answered.`, "turn_already_answered");
    }

    const payload = payloadOf(turn);
    if (payload?.kind !== "coding") {
      throw badRequest("This turn is not a coding problem.", "not_a_coding_turn");
    }

    return json({ hidden_tests: payload.hidden_tests } satisfies CodingTestsResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
