import "server-only";
import { config, type NamedKey } from "@/lib/env";
import { AllKeysExhausted } from "@/lib/errors";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MIN_ATTEMPTS = 7;
const MAX_BACKOFF_MS = 3_000;

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
  if (status === 0) return { cls: "rotate" };
  if (status === 401 || status === 403) return { cls: "dead" };
  if (status === 404) return { cls: "dead" };
  if (status === 429 || (status >= 500 && status <= 599)) {
    return {
      cls: "rotate",
      retryAfterMs: err instanceof ProviderError ? err.retryAfterMs : undefined,
    };
  }
  return { cls: "fatal" };
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

  const dead = new Set<number>();

  for (let n = 0; n < attempts; n++) {
    if (dead.size >= pool.size) break;

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
