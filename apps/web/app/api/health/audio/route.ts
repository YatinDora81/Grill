export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { config } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/clients/http";
import { json } from "@/lib/http";

export async function GET() {
  try {
    const res = await fetchWithTimeout(`${config.audio.serviceUrl}/health`, { method: "GET" }, 4_000);
    return json({ ok: res.ok, status: res.status });
  } catch {
    return json({ ok: false, status: 0 });
  }
}
