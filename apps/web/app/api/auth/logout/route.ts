export const runtime = "nodejs";

import { json, errorResponse } from "@/lib/http";
import { clearSessionCookie } from "@/lib/auth";

export async function POST() {
  try {
    await clearSessionCookie();
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
