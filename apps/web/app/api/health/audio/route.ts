export const runtime = "nodejs";
// Never cache a liveness check — a cached "ok" would mean the ping stops
// reaching the service it exists to keep awake.
export const dynamic = "force-dynamic";

import { config } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/clients/http";
import { json } from "@/lib/http";

/**
 * Keepalive proxy for the Python acoustics service.
 *
 * The browser can't ping it directly — AUDIO_SERVICE_URL is a server-side
 * secret-ish config, not a public one, and a cross-origin ping would need CORS
 * on the Python app. Proxying keeps that URL server-side, and has the useful
 * side effect of keeping *this* server warm too, since the request has to land
 * here first.
 *
 * Deliberately unauthenticated: it's a liveness ping that reveals nothing, and
 * gating it behind a session would mean the sign-in page can't keep the service
 * warm — which is exactly when the warm-up matters, since the first interview
 * follows moments later.
 */
export async function GET() {
  try {
    const res = await fetchWithTimeout(`${config.audio.serviceUrl}/health`, { method: "GET" }, 4_000);
    return json({ ok: res.ok, status: res.status });
  } catch {
    // A sleeping or missing service must not surface as an error to the page:
    // the ping is best-effort, and the interview works without acoustics.
    return json({ ok: false, status: 0 });
  }
}
