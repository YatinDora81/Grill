export const runtime = "nodejs";

import type { DrillReviewResponse } from "@repo/types";
import { json, errorResponse } from "@/lib/http";
import { drillReviewSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { reviewDrillCard } from "@/lib/services/drillService";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`drill-review:${userId}`, { limit: 60, windowMs: 60_000 });

    const { card_id, grade, transcript, answer_scores } = drillReviewSchema.parse(await req.json());

    const result = await reviewDrillCard({
      userId,
      cardId: card_id,
      grade,
      transcript: transcript ?? null,
      answerScores: answer_scores ?? null,
    });
    return json(result satisfies DrillReviewResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
