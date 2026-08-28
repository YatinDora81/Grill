from __future__ import annotations

import asyncio
import logging
import os
import random
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger("audio.sweeper")

MIN_GAP_S = 1.0
SICK_BASE_S = 30.0
_EXP_CAP = 8


def _jitter(gap: float) -> float:
    return gap * random.uniform(0.85, 1.15)


def _backoff(base: float, streak: int, ceiling: float) -> float:
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
        follow_redirects=False,
        limits=httpx.Limits(max_connections=1),
    )


class Sweeper:
    def __init__(self, cfg: Config, client: httpx.AsyncClient) -> None:
        self._cfg = cfg
        self._client = client
        self._quiet = 0
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
            except Exception as exc:  # noqa: BLE001
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
            log.info("[sweeper] no response in %.0fs — drain still in flight", self._cfg.timeout_s)
            return self._moved()

        if r.is_redirect:
            return self._stuck(
                f"redirect to {r.headers.get('location')!r} — "
                "point REPORT_CRON_URL at the final https origin"
            )
        if r.status_code in (401, 404):
            return self._stuck(f"HTTP {r.status_code} — CRON_SECRET missing or mismatched")
        if r.status_code in (408, 504):
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
