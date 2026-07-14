import "server-only";
/**
 * Boot-time configuration. Validated once, fails fast (Grill §Config).
 * Secrets are read ONLY from env — never hardcoded, never logged in full.
 * server-only: this module must never reach the client bundle.
 */

export interface NamedKey {
  /** Human label for redacted logs, e.g. "DORA_YATIN_1". Never the secret. */
  label: string;
  key: string;
}

/** Parse `NAME__SPLIT__APIKEY,...` (or bare `APIKEY,...`) into named keys. */
export function parseKeys(raw: string | undefined): NamedKey[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry, i) => {
      const idx = entry.indexOf("__SPLIT__");
      if (idx === -1) return { label: `#${i}`, key: entry };
      const label = entry.slice(0, idx).trim() || `#${i}`;
      const key = entry.slice(idx + "__SPLIT__".length).trim();
      return { label, key };
    })
    .filter((k) => k.key.length > 0);
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number`);
  return n;
}

const geminiKeys = parseKeys(process.env.GEMINI_API_KEYS);
const groqKeys = parseKeys(process.env.GROQ_API_KEYS);

if (geminiKeys.length === 0) {
  throw new Error("GEMINI_API_KEYS is empty — at least one Gemini key is required.");
}
if (groqKeys.length === 0) {
  console.warn(
    "[env] GROQ_API_KEYS is empty — transcription (Whisper) and Groq fallback disabled.",
  );
}
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required for auth.");
}

export const config = {
  gemini: {
    keys: geminiKeys,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  },
  groq: {
    keys: groqKeys,
    whisperModel: process.env.GROQ_WHISPER_MODEL || "whisper-large-v3",
    llmFallbackModel: process.env.GROQ_LLM_FALLBACK_MODEL || "openai/gpt-oss-120b",
  },
  rotation: {
    baseBackoffMs: num("ROTATION_BASE_BACKOFF_MS", 300),
    providerTimeoutMs: num("PROVIDER_TIMEOUT_MS", 30_000),
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET!,
    cookieName: process.env.AUTH_COOKIE_NAME || "grill_session",
    cookieMaxAgeS: num("AUTH_COOKIE_MAXAGE_S", 1_209_600),
    passwordMinLength: num("PASSWORD_MIN_LENGTH", 8),
  },
  storage: {
    endpoint: process.env.S3_ENDPOINT || "",
    bucket: process.env.S3_BUCKET || "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
  audio: {
    serviceUrl: process.env.AUDIO_SERVICE_URL || "http://localhost:8000",
    maxSeconds: num("MAX_AUDIO_SECONDS", 180),
    maxBytes: num("MAX_AUDIO_MB", 25) * 1024 * 1024,
  },
  interview: {
    defaultNumQuestions: num("DEFAULT_NUM_QUESTIONS", 8),
  },
  presignExpirySeconds: num("PRESIGN_EXPIRY_SECONDS", 300),

  get storageConfigured(): boolean {
    return Boolean(
      this.storage.endpoint &&
        this.storage.bucket &&
        this.storage.accessKeyId &&
        this.storage.secretAccessKey,
    );
  },
  get databaseConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  },
} as const;

export type AppConfig = typeof config;
