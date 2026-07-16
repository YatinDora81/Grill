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
from starlette.types import ASGIApp, Message, Receive, Scope, Send

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


def _max_audio_bytes() -> int:
    """The clip cap, read from the same env var apps/web reads for its own."""
    raw = os.getenv("MAX_AUDIO_MB", "").strip()
    if not raw:
        return 25 * 1024 * 1024
    try:
        return int(float(raw) * 1024 * 1024)
    except ValueError:
        log.warning("MAX_AUDIO_MB=%r is not a number; using 25", raw)
        return 25 * 1024 * 1024


# What the multipart envelope costs on top of the clip: the boundaries, the part
# headers, the filename. Counting the body against a bare clip cap would reject a
# clip that is exactly at the limit — legal by apps/web's reckoning, over by ours,
# and the caller has no way to tell which of the two refused it. apps/web allows
# itself the same slack for the same reason.
MULTIPART_OVERHEAD_BYTES = 16 * 1024

MAX_AUDIO_BYTES = _max_audio_bytes()

#: The ceiling this middleware enforces. Bounds the REQUEST BODY, which is the
#: clip plus its envelope — deliberately not the same number as the clip cap.
MAX_UPLOAD_BYTES = MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES


class _BodyTooLarge(Exception):
    pass


class LimitUploadSize:
    """Counts bytes off the receive channel and aborts once past the cap.

    apps/web checks the clip size before it POSTs, but that is one caller's good
    manners rather than a property of this service: /analyze is unauthenticated,
    so anything that can reach the port can hand us a body of any length. The
    cost of not bounding it is paid twice — the read OOM-kills the process, and
    this process is also the sweeper, so one oversized upload takes the report
    backstop down with it.

    This has to sit on the ASGI stream rather than inside the handler. By the
    time FastAPI resolves an UploadFile it has already run the multipart parser
    over the whole body, so any check in /analyze is one made after the bytes
    have already landed. Refusing here means they are never accumulated at all.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Content-Length only buys a cheap early refusal: it is absent on chunked
        # bodies and freely lied about on hostile ones. The counter below is what
        # actually holds the line.
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
            # Whatever the app has to say once the cap trips is wrong: FastAPI
            # wraps form parsing in a bare `except Exception` and reports the
            # aborted read as its generic 400 "error parsing the body". Drop that
            # and let the 413 below be the answer.
            if tripped:
                return
            await send(message)

        with contextlib.suppress(_BodyTooLarge):
            await self.app(scope, counted_receive, guarded_send)

        if tripped:
            # Nothing reached the client — the parser gave up mid-body and the
            # send above was swallowed — so the response is still ours to write.
            await self._too_large(scope, receive, send)

    @staticmethod
    def _declared_length(scope: Scope) -> int:
        for key, value in scope["headers"]:
            if key == b"content-length":
                try:
                    return int(value)
                except ValueError:
                    return 0  # unparseable: let the counter judge it
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
app.add_middleware(LimitUploadSize, max_bytes=MAX_UPLOAD_BYTES)


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
