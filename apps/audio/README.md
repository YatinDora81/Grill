# apps/audio — acoustic analysis service

The one Python piece (BACKEND_README §2). Takes an audio clip, returns pitch
variation + energy via Parselmouth. Turbo/Bun do **not** manage this venv.

## Requirements

- Python 3.11+
- **ffmpeg** — a *system* dependency (not pip). `brew install ffmpeg` on macOS.

## Setup & run

One-time, to create `.venv` and install deps:

```bash
cd apps/audio
bun run setup
```

After that, `bun dev` from the repo root starts this alongside `web` — the
`dev`/`start` scripts invoke `.venv/bin/uvicorn` directly, so the venv does
**not** need to be activated first.

To run just this service:

```bash
cd apps/audio && bun run dev
```

## API

`POST /analyze` (multipart, field `file`) →

```json
{ "pitch_variation": 18.4, "energy": 0.62, "mean_pitch_hz": 142.0 }
```

`GET /health` → `{ "ok": true }`

The Express API calls this at `/end`, one clip at a time. If it's unreachable,
the report is still built without pitch/energy (pace/pauses/filler still work).
