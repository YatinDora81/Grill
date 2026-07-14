import "server-only";
import { AppError } from "./errors";

/**
 * Minimal in-memory sliding-window limiter for auth routes (Grill security
 * musts). Best-effort: per-instance only. Swap for Redis/Upstash in prod if you
 * run multiple instances.
 */
const hits = new Map<string, number[]>();

export function rateLimit(
  key: string,
  opts: { limit?: number; windowMs?: number } = {},
): void {
  const limit = opts.limit ?? 10;
  const windowMs = opts.windowMs ?? 60_000;
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    throw new AppError(429, "rate_limited", "Too many attempts. Wait a moment and try again.");
  }
  arr.push(now);
  hits.set(key, arr);
}

/** Derive a client key from proxy headers (Vercel sets x-forwarded-for). */
export function clientKey(req: Request, bucket: string): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return `${bucket}:${ip}`;
}
