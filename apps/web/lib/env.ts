import "server-only";
/**
 * Boot-time configuration. Validated once, fails fast (Grill §Config).
 * Secrets are read ONLY from env — never hardcoded, never logged in full.
 * server-only: this module must never reach the client bundle.
 */

export interface NamedKey {
  /**
   * Human label for redacted logs, e.g. "DORA_YATIN_1". Never the secret.
   *
   * Display only, and NOT unique: it comes from operator-supplied env, and the
   * `#N` fallback below is positional. Nothing may key behaviour off it — the
   * rotation pool identifies keys by index for exactly this reason.
   */
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
if (!process.env.GITHUB_TOKEN) {
  // Soft-optional, like Groq: unauthenticated GitHub allows 60 req/hour PER IP,
  // and one project import costs ~30 — effectively broken on shared serverless
  // egress. A classic PAT (no scopes needed for public repos) raises it to 5,000.
  console.warn(
    "[env] GITHUB_TOKEN is empty — GitHub repo imports will hit the 60 req/hour anonymous limit.",
  );
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
  github: {
    /** Optional PAT for repo imports — undefined when unset (never the empty string). */
    token: process.env.GITHUB_TOKEN || undefined,
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
  cron: {
    // Vercel signs cron invocations with this as a bearer token. Soft-optional
    // like storage: absent locally, and the sweep route refuses to run without
    // it rather than defaulting open.
    secret: process.env.CRON_SECRET || "",
  },
  storage: {
    endpoint: process.env.S3_ENDPOINT || "",
    bucket: process.env.S3_BUCKET || "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
  video: {
    /** 100 days, per the retention decision. The sweep reads SessionVideo.expiresAt. */
    retentionDays: num("VIDEO_RETENTION_DAYS", 100),
    /** 640x480 talking head; low enough that an hour is ~180 MB, not 2 GB. */
    bitsPerSecond: num("VIDEO_BITS_PER_SECOND", 400_000),
    /** A part URL is used within seconds of minting; this is pure slack. */
    partUrlExpirySeconds: num("VIDEO_PART_URL_EXPIRY_S", 900),
    /**
     * Playback needs a long expiry: a presigned GET is re-authorised on EVERY
     * Range request the <video> element makes, so a 300s URL 403s mid-scrub on
     * anything longer than five minutes.
     */
    playbackExpirySeconds: num("VIDEO_PLAYBACK_EXPIRY_S", 3_600),
    /** 5 MiB parts x 2000 = ~10 GB, far past any real interview. */
    maxParts: num("VIDEO_MAX_PARTS", 2_000),
  },
  audio: {
    serviceUrl: process.env.AUDIO_SERVICE_URL || "http://localhost:8000",
    maxSeconds: num("MAX_AUDIO_SECONDS", 180),
    maxBytes: num("MAX_AUDIO_MB", 25) * 1024 * 1024,
    /**
     * Matches video's 100 days: both are recordings of the same interview, and
     * keeping the voice a month after the picture went would be a retention
     * promise we didn't make. Derived from Session.createdAt, not stored per
     * clip — see Session.audioPurgedAt.
     */
    retentionDays: num("AUDIO_RETENTION_DAYS", 100),
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
