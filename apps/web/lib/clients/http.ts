import { config } from "@/lib/env";
import { ProviderError } from "./keyPool";

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = config.rotation.providerTimeoutMs,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new ProviderError(0, `network error: ${(err as Error).message}`);
  }
}

function parseRetryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(h);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export async function ensureOk(res: Response, provider: string): Promise<Response> {
  if (res.ok) return res;
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {}
  throw new ProviderError(res.status, `${provider} ${res.status}: ${detail}`, parseRetryAfterMs(res));
}
