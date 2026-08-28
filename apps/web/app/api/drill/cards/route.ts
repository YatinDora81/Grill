export const runtime = "nodejs";

import { json, errorResponse } from "@/lib/http";
import { addDrillCardSchema, suspendDrillCardSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { addDrillCardByTurnId, suspendDrillCard } from "@/lib/services/drillService";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`drill-cards:${userId}`, { limit: 30, windowMs: 60_000 });

    const { turn_id } = addDrillCardSchema.parse(await req.json());
    const card = await addDrillCardByTurnId(userId, turn_id);
    return json({ ok: true, card_id: card.id });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`drill-cards:${userId}`, { limit: 30, windowMs: 60_000 });

    const { card_id } = suspendDrillCardSchema.parse(await req.json());
    const suspended = await suspendDrillCard(userId, card_id);
    return json({ ok: true, suspended });
  } catch (err) {
    return errorResponse(err);
  }
}
