# Grill

AI mock interviews that ask real follow-ups and score how you actually sound.

Paste a job description, résumé, or topic; answer out loud or in writing; get a
report grounded in your own words plus **measured** delivery (pace, pauses,
fillers, pitch, energy). Tone is never inferred from the transcript.

## Layout

| Path | What it is |
|---|---|
| `apps/web` | The product: Next.js 16 App Router — UI **and** the `/api/*` route handlers. |
| `apps/audio` | FastAPI + Parselmouth acoustics service (pitch/energy). Python only. |
| `packages/db` | Prisma 7 schema + client (`@repo/db`). |
| `packages/types` | Shared API contract types (`@repo/types`). |

There is no separate backend app — `apps/web` is the whole stack.

## Stack

Turborepo + Bun workspaces · Next.js 16.2 · React 19 · Prisma 7 (pg driver
adapter) · Neon Postgres · Cloudflare R2 via `aws4fetch` · `@node-rs/argon2` +
`jose` auth · Gemini with a Groq fallback · Groq Whisper for STT.

## Setup

```sh
bun install

# Configure. Never commit real values.
cp apps/web/.env.example apps/web/.env.local   # then fill it in
# packages/db/.env also needs DATABASE_URL (direct, non-pooler host) for the CLI.

bun run dev            # web on http://localhost:4000
```

### Gotchas worth knowing

- **Bun, not pnpm.** Scripts assume `bun run`.
- **DB tables live in the `ai_interview` schema, not `public`.** Both
  `DATABASE_URL`s must keep `?schema=ai_interview`, or queries fail with
  "relation does not exist".
- **`apps/audio` needs Python 3.12 and system `ffmpeg`.** Python 3.14 has no
  `praat-parselmouth` wheel; browsers record WebM/Opus, so ffmpeg is mandatory.
- **Run only one dev server.** `pkill -f "next dev"` leaves the `next-server`
  child alive — kill `next-server` explicitly too.
- **Pin Next ≥ 16.2.10.** 16.2.0's Turbopack watcher spins ~800% CPU while idle
  in this monorepo.

## Environment

`apps/web/.env.example` documents every variable. The ones that bite:

- `JWT_SECRET` — leak it and anyone can forge a login cookie for any user.
- `AUDIO_SERVICE_URL` — in production this **must** point at the deployed
  FastAPI service. On Vercel `localhost:8000` doesn't exist, so pitch/energy
  degrade to `null` silently and the report quietly loses tonality.
- `GEMINI_API_KEYS` / `GROQ_API_KEYS` — comma-separated; the key pool rotates
  per call and backs off on 429/5xx. Without Groq, voice answers don't work.

## Commands

```sh
bun run dev           # all apps
bun run build         # production build
bun run check-types   # tsc across the workspace
bun run lint
```

## Notes

- Every session/report query is scoped to the authenticated `user_id` — a user
  can only ever reach their own data.
- `/api/interview/end` is idempotent and self-healing: an interrupted report
  build is retryable, and a session that already has a report reconciles to
  `completed` rather than getting stuck in `generating_report`.
- The in-memory rate limiter (`lib/rateLimit.ts`) is best-effort and resets per
  instance/cold start. Back it with Redis before running more than one instance.
