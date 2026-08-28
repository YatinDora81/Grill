export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { DrillQueueResponse } from "@repo/types";
import { json, errorResponse } from "@/lib/http";
import { drillQueueQuerySchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { getDrillQueue } from "@/lib/services/drillService";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXCLUDE_MAX = 20;

function excluded(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => UUID.test(id))
    .slice(0, EXCLUDE_MAX);
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`drill-queue:${userId}`, { limit: 60, windowMs: 60_000 });

    const url = new URL(req.url);
    const { limit } = drillQueueQuerySchema.parse({ limit: url.searchParams.get("limit") });

    const queue = await getDrillQueue(userId, {
      limit,
      exclude: excluded(url.searchParams.get("exclude")),
    });
    return json(queue satisfies DrillQueueResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
