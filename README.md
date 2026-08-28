# Grill

AI mock interviews that ask real follow-ups and score how you actually sound.

Paste a job description, résumé, or topic; answer out loud or in writing; get a
report grounded in your own words plus **measured** delivery (pace, pauses,
fillers, pitch, energy, voice steadiness, and — when the camera is on — how much
of the time you looked at the lens). Anything that wasn't measured reads as an em
dash, never as a zero, and tone is never inferred from the transcript.

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
- **The face landmarker model is downloaded, not committed.** `bun install` runs
  a postinstall in `apps/web` that stages the MediaPipe WASM runtime and fetches
  the ~3.6 MB `face_landmarker.task` into `public/models/`. It never fails an
  install: behind a proxy or offline it warns and moves on, and the room then
  treats on-camera delivery as "not measured" (em dashes in the report) instead
  of crashing. Once you're online, `cd apps/web && node
  scripts/fetch-face-model.mjs` fills it in.

## Environment

`apps/web/.env.example` documents every variable. The ones that bite:

- `JWT_SECRET` — leak it and anyone can forge a login cookie for any user.
- `AUDIO_SERVICE_URL` — in production this **must** point at the deployed
  FastAPI service. On Vercel `localhost:8000` doesn't exist, so pitch, energy
  and the voice-quality cells (jitter, shimmer, clarity, uptalk) degrade to
  `null` silently and the report quietly loses tonality.
- `GEMINI_API_KEYS` / `GROQ_API_KEYS` — comma-separated; the key pool rotates
  per call and backs off on 429/5xx. Without Groq, voice answers don't work.

Everything below is **optional and unset by default** — unset is a supported
mode, not a broken one. Each is either an all-or-nothing group or a plain
number, and setting only half of a group warns at boot and changes nothing:

- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — makes rate limits hold
  across instances and regions, and gives the interviewer voice's daily budget a
  counter a cold start can't reset.
- `QSTASH_TOKEN` + `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` —
  hands report builds to a queue with its own retries.
- `TTS_ENABLED=1` (plus `GROQ_TTS_MODEL`, `TTS_DAILY_BUDGET`, `TTS_CACHE_PREFIX`,
  `TTS_MAX_CHARS`) — the interviewer reads questions in a neural voice instead of
  the browser's. Needs Groq keys **and** R2; without either it warns and falls
  back.
- `DRILL_DAILY_CARDS`, `DRILL_DIGEST_DAYS` — how big a daily drill deck is, and
  how often the nudge email may go out.

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
- **Rate limits** (`lib/rateLimit.ts`) are Redis-backed when the Upstash pair is
  set, and fall back to a per-instance in-memory window otherwise — and on a
  Redis outage, which degrades rather than failing an interview in progress.
- **Report builds** run in `after()` on the request that ended the interview by
  default. With QStash configured they become queued messages instead, delivered
  to `POST /api/queue/report` — deliberately outside the auth proxy's matcher,
  because a queue delivery carries no cookie and the Upstash signature is its
  authentication. A publish that fails falls straight back to `after()`, so the
  candidate never loses a report to a queue outage. Once: `cd apps/web && bun
  scripts/qstash-schedule.mjs` moves the backstop sweep from Vercel's daily cron
  to every ten minutes.
- **Daily drill** (`/drill`) is an SM-2 deck seeded from answers a report scored
  badly and from questions you star. Grading is self-assessed after the rubric
  proposes a grade; drill audio is transcribed and thrown away, never stored. The
  weekly nudge email rides along on the same cron slot as the retention purges
  and is opt-out per user.
- **Interviewer voice**: with `TTS_ENABLED=1`, questions are read by Groq's
  Orpheus model and cached in R2 under `TTS_CACHE_PREFIX`, keyed by a hash of
  (model, voice, text) — so a retry or a re-run of a question set costs nothing.
  Give that prefix a 30-day lifecycle rule in the Cloudflare dashboard.
- **On-camera delivery** is measured in the browser with MediaPipe Face
  Landmarker; the WASM runtime and the landmarker model are staged into
  `public/` by a postinstall script (see the setup gotcha above — if that
  download was blocked the metrics read "—" and nothing else changes).
  No frames ever leave the device — only the per-answer aggregates. The room's
  live coaching drawer likewise uses the browser's own `SpeechRecognition` where
  it exists (Chrome/Edge/Safari) and is a HUD only; the report is always built
  from the recording.
- **The STAR time bar** under a behavioural answer splits the answer's **time**
  across Situation / Task / Action / Result, from Whisper's word timestamps —
  by word count for typed answers. The model only labels which part of the story
  each sentence serves; it never decides the proportions. It is computed once at
  report build and stored, so a report can't relabel itself between reads, and
  the bars travel with a shared `/r/[token]` report.
- **Then vs now** appears on the report of a retry: score, category and delivery
  deltas, plus a word-level diff of each answer against the run it retried. It
  is arithmetic over rows already stored — no model call — and it hides itself
  if the parent interview has since been deleted.
- **Job URL import** on `/new`: Greenhouse, Lever and Ashby postings come from
  their public APIs with no model call. Anything else is fetched server-side
  behind an SSRF guard (https only, no private or link-local hosts, redirects
  re-checked, 2 MB cap) and read from `JobPosting` JSON-LD, with one LLM cleanup
  pass as the fallback. Pages behind a login — LinkedIn, mostly — can't be
  fetched at all, so `/profile` offers a bookmarklet that hands the page over
  from the browser you're already signed in to; the page text rides in the URL
  fragment, which never reaches a server log.
- **Company prep briefs** are one Gemini call with Google Search grounding,
  cached per (company, role) for a fortnight in `company_briefs` — shared across
  users on purpose, since nothing in a brief is about the user. Without search
  the brief still builds and is labelled as general knowledge rather than news.
