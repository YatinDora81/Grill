import "server-only";

export interface NamedKey {
  label: string;
  key: string;
}

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
  console.warn(
    "[env] GITHUB_TOKEN is empty — GitHub repo imports will use the anonymous 60 req/hour limit.",
  );
}
if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
  console.warn(
    "[env] SMTP_EMAIL/SMTP_PASSWORD are empty — password reset emails will not be sent.",
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
  mail: {
    user: process.env.SMTP_EMAIL || "",
    password: process.env.SMTP_PASSWORD || "",
    senderName: process.env.SENDER_NAME || "Grill",
    resetTokenTtlMinutes: num("PASSWORD_RESET_TTL_MINUTES", 60),
  },
  cron: {
    secret: process.env.CRON_SECRET || "",
  },
  storage: {
    endpoint: process.env.S3_ENDPOINT || "",
    bucket: process.env.S3_BUCKET || "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
  video: {
    retentionDays: num("VIDEO_RETENTION_DAYS", 100),
    bitsPerSecond: num("VIDEO_BITS_PER_SECOND", 400_000),
    partUrlExpirySeconds: num("VIDEO_PART_URL_EXPIRY_S", 900),
    playbackExpirySeconds: num("VIDEO_PLAYBACK_EXPIRY_S", 3_600),
    maxParts: num("VIDEO_MAX_PARTS", 2_000),
  },
  audio: {
    serviceUrl: process.env.AUDIO_SERVICE_URL || "http://localhost:8000",
    maxSeconds: num("MAX_AUDIO_SECONDS", 180),
    maxBytes: num("MAX_AUDIO_MB", 25) * 1024 * 1024,
    retentionDays: num("AUDIO_RETENTION_DAYS", 100),
  },
  interview: {
    defaultNumQuestions: num("DEFAULT_NUM_QUESTIONS", 8),
  },
  site: {
    url: process.env.NEXT_PUBLIC_SITE_URL
      ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "")
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:4000",
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
  get mailConfigured(): boolean {
    return Boolean(this.mail.user && this.mail.password);
  },
  get databaseConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  },
} as const;

export type AppConfig = typeof config;
