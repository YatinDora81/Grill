"""apps/audio — tiny FastAPI service. Two jobs.

1. POST /analyze — audio bytes → a few numbers. apps/web calls this while it
   builds a report. Because audio lives in the object bucket, this can also run
   on a PC reading from the same bucket — the detachable worker (§13).
2. The report sweeper (sweeper.py). It lives here for exactly one reason:
   apps/web is serverless and has no clock of its own, so this is the only
   process in the system that is always running.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections.abc import AsyncIterator

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from analysis import analyze
from sweeper import Config, Sweeper, build_client

# uvicorn configures only its own loggers and leaves the root alone, so without
# this every line below WARNING from this module and sweeper.py is dropped on the
# floor — including the one naming the URL the sweeper is actually hitting, which
# is the only positive confirmation that it is on.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(levelname)s:     %(message)s",
)

log = logging.getLogger("audio")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.sweeper = None
    app.state.sweeper_task = None

    cfg = Config.from_env()
    if cfg is None:
        yield  # unconfigured: /analyze still serves, which is the actual job
        return

    async with build_client(cfg) as client:
        sweeper = Sweeper(cfg, client)
        # Hold the handle. asyncio keeps only a weak reference to a task, so one
        # with no live reference can be garbage-collected mid-flight.
        task = asyncio.create_task(sweeper.run(), name="report-sweeper")
        app.state.sweeper = sweeper
        app.state.sweeper_task = task
        log.info("[sweeper] on → %s", cfg.url)
        try:
            yield
        finally:
            # Cancel lands on whatever is being awaited — the sleep, or the
            # socket read — so shutdown is immediate rather than waiting out the
            # timeout. Abandoning a sweep mid-request is safe: apps/web finishes
            # the build it started, and the lease protects the row it claimed.
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    # The client closes only here, once the task is provably gone.


app = FastAPI(title="ai-interview audio service", lifespan=lifespan)


@app.get("/health")
def health() -> JSONResponse:
    sweeper: Sweeper | None = getattr(app.state, "sweeper", None)
    if sweeper is None:
        return JSONResponse({"ok": True, "sweeper": None})
    snap = sweeper.snapshot(getattr(app.state, "sweeper_task", None))
    # A dead sweeper is otherwise invisible — the symptom is reports quietly
    # never retrying. Fail the check so the platform restarts us.
    return JSONResponse(
        {"ok": snap["running"], "sweeper": snap},
        status_code=200 if snap["running"] else 503,
    )


@app.post("/analyze")
async def analyze_endpoint(file: UploadFile = File(...)) -> dict[str, float]:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty audio")
    try:
        # ffmpeg and Parselmouth are synchronous C. Called inline they block the
        # event loop, which now also stalls the sweeper and this service's own
        # health check.
        return await asyncio.to_thread(analyze, data)
    except Exception as exc:  # noqa: BLE001 — surface a clean 500 to the caller
        raise HTTPException(status_code=500, detail=f"analysis failed: {exc}") from exc
