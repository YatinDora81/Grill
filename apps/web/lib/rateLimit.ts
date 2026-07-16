import "server-only";
import { AppError } from "./errors";

/**
 * Minimal in-memory sliding-window limiter for auth routes (Grill security
 * musts). Best-effort: per-instance only. Swap for Redis/Upstash in prod if you
 * run multiple instances.
 */
type Entry = { times: number[]; expiresAt: number };

const hits = new Map<string, Entry>();

/**
 * Two bounds on the map, because keys come from the network and most are seen
 * once: the sweep drops entries whose window has fully elapsed, and the cap is
 * the backstop for a burst that outruns the sweep interval. Insertion order is
 * kept as LRU order (delete-then-set below) so the cap sheds the coldest keys
 * first; a shed key does forgive attempts still inside its window, so keep
 * MAX_KEYS far above any plausible legitimate concurrent-client count.
 */
const MAX_KEYS = 10_000;
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;

export function rateLimit(
  key: string,
  opts: { limit?: number; windowMs?: number } = {},
): void {
  const limit = opts.limit ?? 10;
  const windowMs = opts.windowMs ?? 60_000;
  const now = Date.now();

  if (now - lastSweep >= SWEEP_INTERVAL_MS) {
    for (const [k, entry] of hits) {
      if (entry.expiresAt <= now) hits.delete(k);
    }
    lastSweep = now;
  }

  const times = (hits.get(key)?.times ?? []).filter((t) => now - t < windowMs);
  if (times.length >= limit) {
    throw new AppError(429, "rate_limited", "Too many attempts. Wait a moment and try again.");
  }
  times.push(now);
  hits.delete(key);
  hits.set(key, { times, expiresAt: now + windowMs });

  while (hits.size > MAX_KEYS) {
    const coldest = hits.keys().next();
    if (coldest.done) break;
    hits.delete(coldest.value);
  }
}

/**
 * Derive a client key from proxy headers. Vercel appends the peer it actually
 * accepted the connection from as the RIGHTMOST x-forwarded-for entry, so every
 * hop to its left is whatever the caller chose to send and can be rotated per
 * request to mint a fresh limit. Only the last hop is vouched for, so that is
 * the one we key on.
 *
 * If the header is missing there is no proxy in front of us and nothing in the
 * request is trustworthy — x-real-ip included, since it would be caller-supplied
 * too. Those requests collapse into one shared bucket: coarse, but it fails
 * toward limiting rather than handing out an unlimited key space.
 */
export function clientKey(req: Request, bucket: string): string {
  const hops =
    req.headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((hop) => hop.trim())
      .filter(Boolean) ?? [];
  const ip = hops[hops.length - 1] ?? "unknown";
  return `${bucket}:${ip}`;
}
