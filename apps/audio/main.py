from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import os
from collections.abc import AsyncIterator

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from analysis import analyze
from sweeper import Config, Sweeper, build_client

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(levelname)s:     %(message)s",
)

log = logging.getLogger("audio")


def _max_audio_bytes() -> int:
    raw = os.getenv("MAX_AUDIO_MB", "").strip()
    if not raw:
        return 25 * 1024 * 1024
    try:
        return int(float(raw) * 1024 * 1024)
    except ValueError:
        log.warning("MAX_AUDIO_MB=%r is not a number; using 25", raw)
        return 25 * 1024 * 1024


MULTIPART_OVERHEAD_BYTES = 16 * 1024

MAX_AUDIO_BYTES = _max_audio_bytes()

MAX_SENTENCE_ENDS = 10_000

MAX_UPLOAD_BYTES = MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES


class _BodyTooLarge(Exception):
    pass


class LimitUploadSize:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if self._declared_length(scope) > self.max_bytes:
            await self._too_large(scope, receive, send)
            return

        read = 0
        tripped = False

        async def counted_receive() -> Message:
            nonlocal read, tripped
            message = await receive()
            if message["type"] == "http.request":
                read += len(message.get("body", b""))
                if read > self.max_bytes:
                    tripped = True
                    raise _BodyTooLarge
            return message

        async def guarded_send(message: Message) -> None:
            if tripped:
                return
            await send(message)

        with contextlib.suppress(_BodyTooLarge):
            await self.app(scope, counted_receive, guarded_send)

        if tripped:
            await self._too_large(scope, receive, send)

    @staticmethod
    def _declared_length(scope: Scope) -> int:
        for key, value in scope["headers"]:
            if key == b"content-length":
                try:
                    return int(value)
                except ValueError:
                    return 0
        return 0

    async def _too_large(self, scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse(
            {"detail": f"audio too large (limit {self.max_bytes} bytes)"},
            status_code=413,
        )
        await response(scope, receive, send)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.sweeper = None
    app.state.sweeper_task = None

    cfg = Config.from_env()
    if cfg is None:
        yield
        return

    async with build_client(cfg) as client:
        sweeper = Sweeper(cfg, client)
        task = asyncio.create_task(sweeper.run(), name="report-sweeper")
        app.state.sweeper = sweeper
        app.state.sweeper_task = task
        log.info("[sweeper] on → %s", cfg.url)
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="ai-interview audio service", lifespan=lifespan)
app.add_middleware(LimitUploadSize, max_bytes=MAX_UPLOAD_BYTES)


@app.get("/health")
def health() -> JSONResponse:
    sweeper: Sweeper | None = getattr(app.state, "sweeper", None)
    if sweeper is None:
        return JSONResponse({"ok": True, "sweeper": None})
    snap = sweeper.snapshot(getattr(app.state, "sweeper_task", None))
    return JSONResponse(
        {"ok": snap["running"], "sweeper": snap},
        status_code=200 if snap["running"] else 503,
    )


def _parse_sentence_ends(raw: str | None) -> list[float] | None:
    if raw is None:
        return None
    raw = raw.strip()
    if not raw:
        return None

    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"sentence_ends is not valid JSON: {exc}"
        ) from exc

    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=400, detail="sentence_ends must be a JSON array of seconds"
        )
    if len(parsed) > MAX_SENTENCE_ENDS:
        raise HTTPException(
            status_code=400,
            detail=f"sentence_ends holds more than {MAX_SENTENCE_ENDS} entries",
        )

    ends: list[float] = []
    for value in parsed:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise HTTPException(
                status_code=400, detail="sentence_ends must contain only numbers"
            )
        seconds = float(value)
        if not math.isfinite(seconds) or seconds < 0:
            raise HTTPException(
                status_code=400,
                detail="sentence_ends must contain only finite, non-negative seconds",
            )
        ends.append(seconds)
    return ends


@app.post("/analyze")
async def analyze_endpoint(
    file: UploadFile = File(...),
    sentence_ends: str | None = Form(None),
) -> dict[str, float | int | None]:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty audio")
    ends = _parse_sentence_ends(sentence_ends)
    try:
        return await asyncio.to_thread(analyze, data, ends)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"analysis failed: {exc}") from exc
