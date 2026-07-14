"""apps/audio — tiny FastAPI service. One job: audio bytes → a few numbers.

Not public. The Express API (apps/api) calls POST /analyze during /end.
Because audio lives in the object bucket, this can run on the server OR on a
PC reading from the same bucket — the detachable worker (BACKEND_README §13).
"""

from __future__ import annotations

from fastapi import FastAPI, File, HTTPException, UploadFile

from analysis import analyze

app = FastAPI(title="ai-interview audio service")


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/analyze")
async def analyze_endpoint(file: UploadFile = File(...)) -> dict[str, float]:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty audio")
    try:
        return analyze(data)
    except Exception as exc:  # noqa: BLE001 — surface a clean 500 to the caller
        raise HTTPException(status_code=500, detail=f"analysis failed: {exc}") from exc
