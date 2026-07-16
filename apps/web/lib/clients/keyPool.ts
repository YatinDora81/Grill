import "server-only";
/**
 * Multi-key rotation (Grill §rotation). Failover, not quota multiplication.
 *
 * Rotate on 429/5xx, and on 401/403 — a key that's revoked, or whose project
 * has been denied access, is that key's problem, and the whole point of a pool
 * is that the next key can still serve the request. Only 400 is fatal: a
 * malformed request stays malformed no matter who signs it.
 *
 * Keep trying for at least MIN_ATTEMPTS, cycling the pool more than once if it
 * is small — most failures here are 429s that clear within seconds.
 *
 * Never log a full key — label + last-4 only.
 */
import { config, type NamedKey } from "@/lib/env";
import { AllKeysExhausted } from "@/lib/errors";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Try this hard before giving up, even when the pool is smaller than this. */
const MIN_ATTEMPTS = 7;
/** Don't let linear backoff run away on the later attempts. */
const MAX_BACKOFF_MS = 3_000;

/** `dead` = this key is finished for this request; rotate and never retry it. */
type ErrClass = "rotate" | "dead" | "fatal";

export class ProviderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

function classify(err: unknown): { cls: ErrClass; retryAfterMs?: number } {
  const status = err instanceof ProviderError ? err.status : 0;
  if (status === 0) return { cls: "rotate" }; // network/timeout → transient
  if (status === 401 || status === 403) return { cls: "dead" }; // revoked key / denied project
  // 404 reads like "our request" but Gemini scopes model access per project: one
  // key answers `This model is no longer available` while every other key serves
  // the same model fine. Treating it as fatal let a single restricted key kill a
  // request the healthy keys could serve — and because generateText only reaches
  // Groq on AllKeysExhausted, a fatal skipped the fallback too. It's a key fact,
  // so it kills the key, not the request. A genuinely wrong model name now 404s
  // every key, exhausts the pool, and degrades to Groq instead of hard-failing.
  if (status === 404) return { cls: "dead" };
  if (status === 429 || (status >= 500 && status <= 599)) {
    return {
      cls: "rotate",
      retryAfterMs: err instanceof ProviderError ? err.retryAfterMs : undefined,
    };
  }
  return { cls: "fatal" }; // 400 and friends: our request, not our key
}

export class KeyPool {
  private i = 0;
  constructor(
    public readonly name: string,
    public readonly keys: NamedKey[],
  ) {}
  current(): NamedKey {
    const k = this.keys[this.i];
    if (!k) throw new Error(`empty key pool: ${this.name}`);
    return k;
  }
  /** Position of `current()`. The only stable identity a key has — labels are
   * display strings and may repeat. */
  get index(): number {
    return this.i;
  }
  advance(): void {
    this.i = (this.i + 1) % this.keys.length;
  }
  get size(): number {
    return this.keys.length;
  }
  get isEmpty(): boolean {
    return this.keys.length === 0;
  }
}

function logKeyFailure(
  pool: KeyPool,
  attempt: number,
  attempts: number,
  k: NamedKey,
  err: unknown,
) {
  const last4 = k.key.slice(-4);
  const status = err instanceof ProviderError ? err.status : "net";
  console.warn(
    `[keyPool:${pool.name}] attempt ${attempt + 1}/${attempts} failed on ` +
      `${pool.name}#${k.label} (…${last4}) status=${status}`,
  );
}

export async function callWithRotation<T>(
  pool: KeyPool,
  makeRequest: (key: string) => Promise<T>,
  opts: { attempts?: number; baseBackoffMs?: number } = {},
): Promise<T> {
  if (pool.isEmpty) throw new Error(`empty key pool: ${pool.name}`);
  const attempts = opts.attempts ?? Math.max(pool.size, MIN_ATTEMPTS);
  const base = opts.baseBackoffMs ?? config.rotation.baseBackoffMs;
  let lastErr: unknown;

  // Keys that answered 401/403 this request. Because `attempts` can exceed the
  // pool size we come back around, and re-asking a revoked key is a guaranteed
  // waste of a turn.
  //
  // Keyed by pool index, not label: labels come from operator-supplied env
  // (`NAME__SPLIT__KEY`) and nothing forces them to be unique, so two keys
  // sharing one would make the first 401 retire both — including a key that
  // still works. The index is unique by construction.
  const dead = new Set<number>();

  for (let n = 0; n < attempts; n++) {
    if (dead.size >= pool.size) break; // every key rejected us outright

    // Land on a key that hasn't already been ruled out.
    for (let hop = 0; hop < pool.size && dead.has(pool.index); hop++) {
      pool.advance();
    }

    const k = pool.current();
    try {
      return await makeRequest(k.key);
    } catch (err) {
      lastErr = err;
      const { cls, retryAfterMs } = classify(err);
      if (cls === "fatal") throw err;
      logKeyFailure(pool, n, attempts, k, err);

      if (cls === "dead") {
        // No backoff: the key isn't busy, it's gone. Move straight on.
        dead.add(pool.index);
        pool.advance();
        continue;
      }

      const backoff = Math.min(
        retryAfterMs ?? base * (n + 1) + Math.floor(Math.random() * 200),
        MAX_BACKOFF_MS,
      );
      await sleep(backoff);
      pool.advance();
    }
  }
  throw new AllKeysExhausted(lastErr);
}

export const geminiPool = new KeyPool("gemini", config.gemini.keys);
export const groqPool = new KeyPool("groq", config.groq.keys);
