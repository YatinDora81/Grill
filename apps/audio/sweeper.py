"""The caller that /api/cron/reports never had.

apps/web already knows how to drain queued reports and purge expired videos —
that is GET /api/cron/reports. What the system lacks is anything to CALL it on a
clock: apps/web is serverless, so nothing there exists between requests. This
service is the only always-running process, so the loop lives here. Every line of
report logic stays in TypeScript; this file is a caller and nothing else.

Shape: request -> await it to completion -> sleep -> repeat. One coroutine, so a
second sweep cannot begin while the first is in flight, and the gap is measured
from completion rather than from the previous start. Overlap is impossible by the
shape of the loop rather than prevented by a lock someone can misconfigure.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger("audio.sweeper")

# A typo'd 0 would turn this into a hot loop against a 300s serverless function.
MIN_GAP_S = 1.0
# Backing off after a sweep whose every claim failed. Deliberately far slower
# than the busy gap — see the `failed and not built` branch, where this is the
# difference between preserving a report and destroying it.
SICK_BASE_S = 30.0
# 2**8 already clears every ceiling here. Uncapped, a multi-day outage grows the
# exponent until the float overflows and takes the task down with it.
_EXP_CAP = 8


def _jitter(gap: float) -> float:
    """Replicas — and a synchronised restart — must not wake Neon in unison."""
    return gap * random.uniform(0.85, 1.15)


def _backoff(base: float, streak: int, ceiling: float) -> float:
    # Jitter goes on AFTER the clamp, so the real ceiling is ceiling * 1.15. That
    # is deliberate: at the ceiling every replica is idle, which is precisely
    # when they would otherwise all wake together — clamping last would strip the
    # jitter off exactly the case it exists for.
    return _jitter(min(base * 2 ** min(max(streak - 1, 0), _EXP_CAP), ceiling))


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        log.warning("[sweeper] %s=%r is not a number; using %s", name, raw, default)
        return default


@dataclass(frozen=True)
class Config:
    url: str
    secret: str
    busy_gap_s: float
    max_gap_s: float
    timeout_s: float

    @classmethod
    def from_env(cls) -> Config | None:
        """None means "do not start", and always logs why.

        Degrades rather than refusing to boot: /analyze is this service's actual
        job, and local dev has no CRON_SECRET. A backstop must never be able to
        take the primary path down with it.
        """
        if os.getenv("REPORT_CRON_ENABLED", "true").strip().lower() not in ("1", "true", "yes"):
            log.info("[sweeper] off (REPORT_CRON_ENABLED)")
            return None

        url = os.getenv("REPORT_CRON_URL", "").strip()
        secret = os.getenv("CRON_SECRET", "").strip()
        if not url or not secret:
            missing = " and ".join(
                n for n, v in (("REPORT_CRON_URL", url), ("CRON_SECRET", secret)) if not v
            )
            log.warning("[sweeper] NOT RUNNING: %s unset — no report backstop from here", missing)
            return None

        busy = max(_env_float("REPORT_CRON_BUSY_GAP_S", 5.0), MIN_GAP_S)
        timeout = _env_float("REPORT_CRON_TIMEOUT_S", 330.0)
        if timeout < 300.0:
            # The route sends nothing until the drain returns, so this read
            # timeout covers the whole call and must clear its maxDuration = 300.
            # Set it short and we abort healthy drains — manufacturing the exact
            # failures this loop exists to clean up.
            log.warning(
                "[sweeper] REPORT_CRON_TIMEOUT_S=%.0f is under the route's 300s ceiling", timeout
            )

        return cls(
            url=url,
            secret=secret,
            busy_gap_s=busy,
            max_gap_s=max(_env_float("REPORT_CRON_MAX_GAP_S", 600.0), busy),
            timeout_s=timeout,
        )


def build_client(cfg: Config) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(cfg.timeout_s, connect=10.0),
        # httpx strips Authorization across an origin hop, so a chased redirect
        # arrives unauthenticated and 404s. An http:// URL that Vercel 308s to
        # https:// would otherwise look like a permanently broken secret.
        follow_redirects=False,
        # A sequential loop can never open a second connection.
        limits=httpx.Limits(max_connections=1),
    )


class Sweeper:
    def __init__(self, cfg: Config, client: httpx.AsyncClient) -> None:
        self._cfg = cfg
        self._client = client
        self._quiet = 0  # consecutive runs that moved nothing
        self.runs = 0
        self.swept_total = 0
        self.purged_total = 0
        self.last: str | None = None
        self.last_error: str | None = None

    async def run(self) -> None:
        while True:
            try:
                gap = await self._once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — this loop must be unkillable.
                # A dead task's only symptom is reports silently never retrying.
                self._quiet += 1
                self.last, self.last_error = "error", repr(exc)
                gap = _backoff(10.0, self._quiet, self._cfg.max_gap_s)
                log.warning(
                    "[sweeper] sweep failed (%d in a row), next in %.0fs: %r",
                    self._quiet,
                    gap,
                    exc,
                )
            self.runs += 1
            await asyncio.sleep(gap)

    async def _once(self) -> float:
        try:
            r = await self._client.get(
                self._cfg.url, headers={"Authorization": f"Bearer {self._cfg.secret}"}
            )
        except httpx.ReadTimeout:
            # We waited past the route's own ceiling, so the drain is still
            # running over there and its lease covers whatever it claimed.
            log.info("[sweeper] no response in %.0fs — drain still in flight", self._cfg.timeout_s)
            return self._moved()

        if r.is_redirect:
            return self._stuck(
                f"redirect to {r.headers.get('location')!r} — "
                "point REPORT_CRON_URL at the final https origin"
            )
        if r.status_code in (401, 404):
            # Not fixable by retrying: 404 means CRON_SECRET is unset on apps/web
            # (the route refuses rather than defaulting open), 401 means ours
            # doesn't match. Pinned slow rather than stopped, so correcting the
            # secret self-heals without a redeploy.
            return self._stuck(f"HTTP {r.status_code} — CRON_SECRET missing or mismatched")
        if r.status_code in (408, 504):
            # It ran out of clock, which means it HAD work. Backing off here
            # would penalise exactly the case that needs another pass.
            log.info("[sweeper] apps/web hit its duration ceiling; backlog remains")
            return self._moved()

        r.raise_for_status()
        body: dict[str, Any] = r.json()
        swept = int(body.get("swept", 0) or 0)
        purged = int(body.get("purged", 0) or 0)
        built = int(body.get("built", 0) or 0) + int(body.get("already_built", 0) or 0)
        failed = int(body.get("failed", 0) or 0)

        self.swept_total += swept
        self.purged_total += purged
        self.last_error = None
        if swept or purged:
            log.info("[sweeper] %s", body)

        if failed and not built:
            # Every claim failed, so the provider is sick — the queue isn't. Each
            # claim burns one of apps/web's MAX_REPORT_ATTEMPTS (5), a retryable
            # failure drops the lease so the row is instantly claimable again,
            # and nothing ever resets the counter. Sweeping this at the busy gap
            # would fail every queued report out of existence inside a minute.
            # Spread the remaining attempts across the outage instead.
            self._quiet += 1
            self.last = "sick"
            gap = _backoff(SICK_BASE_S, self._quiet, self._cfg.max_gap_s)
            log.warning(
                "[sweeper] %d failed and 0 built — backing off %.0fs to preserve retry attempts",
                failed,
                gap,
            )
            return gap

        if built or purged:
            return self._moved()

        # Nothing queued. Every poll is a Neon query, and a serverless DB polled
        # every 5s never autosuspends — an empty queue earns a longer sleep.
        self._quiet += 1
        self.last = "idle"
        return _backoff(self._cfg.busy_gap_s, self._quiet, self._cfg.max_gap_s)

    def _moved(self) -> float:
        self._quiet = 0
        self.last = "work"
        return _jitter(self._cfg.busy_gap_s)

    def _stuck(self, why: str) -> float:
        self._quiet += 1
        self.last, self.last_error = "stuck", why
        log.error("[sweeper] %s — the report backstop is NOT running", why)
        return _backoff(SICK_BASE_S, self._quiet, self._cfg.max_gap_s)

    def snapshot(self, task: asyncio.Task[None] | None) -> dict[str, Any]:
        """Read the TASK, not this object: it outlives a crashed loop and would
        otherwise happily report running=True forever."""
        crashed: str | None = None
        if task is not None and task.done() and not task.cancelled():
            exc = task.exception()
            crashed = repr(exc) if exc else "loop returned unexpectedly"
        return {
            "running": task is not None and not task.done(),
            "crashed": crashed,
            "runs": self.runs,
            "swept_total": self.swept_total,
            "purged_total": self.purged_total,
            "last": self.last,
            "last_error": self.last_error,
        }
