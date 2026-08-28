export const runtime = "nodejs";
export const maxDuration = 60;

import type { CompanyBriefResponse } from "@repo/types";
import { json, errorResponse } from "@/lib/http";
import { companyBriefRequestSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { buildBrief, readCachedBrief } from "@/lib/services/companyBriefService";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const { company, role, refresh } = companyBriefRequestSchema.parse(await req.json());

    if (!refresh) {
      const hit = await readCachedBrief({ company, role });
      if (hit) return json(hit satisfies CompanyBriefResponse);
    }

    await rateLimit(`brief:${userId}`, { limit: 6, windowMs: 10 * 60_000 });
    const brief = await buildBrief({ company, role });
    return json(brief satisfies CompanyBriefResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
