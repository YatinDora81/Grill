export const runtime = "nodejs";

import { json, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/auth";
import { getDashboardData } from "@/lib/services/dashboardService";

export async function GET() {
  try {
    const userId = await requireUserId();
    return json(await getDashboardData(userId));
  } catch (err) {
    return errorResponse(err);
  }
}
