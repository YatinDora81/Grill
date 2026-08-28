# apps/audio — acoustic analysis service

The one Python piece (BACKEND_README §2). Takes an audio clip, returns pitch,
energy and voice quality (jitter, shimmer, HNR, uptalk) via Parselmouth.
Turbo/Bun do **not** manage this venv.

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

`POST /analyze` (multipart) →

```json
{
  "pitch_variation": 18.4,
  "energy": 0.62,
  "mean_pitch_hz": 142.0,
  "jitter_local": 0.0119,
  "shimmer_local": 0.0684,
  "hnr_db": 17.32,
  "uptalk_statements": 9,
  "uptalk_rising": 4
}
```

Fields:

- `file` (required) — the clip.
- `sentence_ends` (optional) — a JSON array of seconds into *this* clip where a
  statement ends, e.g. `[3.4, 9.1]`. Used only for uptalk. Real questions must be
  excluded by the caller: a rise at the end of one is grammar, not hedging. A
  malformed value is a 400 rather than a silent fallback.

The last five fields are the voice-quality set. `jitter_local` and
`shimmer_local` are ratios (`0.01` == 1 %), `hnr_db` is harmonics-to-noise in dB,
and the two uptalk figures are counts.

**Null means NOT MEASURED, never zero.** A clip Praat cannot cycle-mark (silent,
too short, entirely unvoiced) reports `null` for jitter/shimmer/HNR, and a
request that sends no `sentence_ends` reports `null` for both uptalk counters —
which is a different fact from `0`, i.e. "judged, and none rose". Praat's `nan`
never reaches the JSON.

`GET /health` → `{ "ok": true }`

apps/web calls this while it builds a report, one clip at a time. If it's
unreachable, the report is still built without any of these (pace/pauses/filler
still work).
