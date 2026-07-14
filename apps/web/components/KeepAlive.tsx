"use client";

import { useEffect } from "react";

/**
 * Keeps the Python acoustics service warm.
 *
 * Free-tier hosts idle a service out after ~15 minutes and then take 30s+ to
 * cold-start. That's survivable on the dashboard; it is not survivable when it
 * happens between two answers, because the report is built the moment the last
 * one lands. So every page pings — the interview isn't the only place that
 * matters, it's just the worst place to discover the service is asleep.
 *
 * Fire-and-forget by design: the ping's only job is to arrive. A failure means
 * the service is down or waking, which the page can do nothing about and the
 * user should never see.
 */
const PING_MS = 5_000;

export function KeepAlive() {
  useEffect(() => {
    let cancelled = false;

    const ping = () => {
      if (cancelled) return;
      // `keepalive` lets the request outlive a navigation, so a ping fired as
      // the user moves between pages still lands.
      void fetch("/api/health/audio", { cache: "no-store", keepalive: true }).catch(() => {
        /* down or waking — nothing to do, and nothing worth logging */
      });
    };

    ping(); // don't wait a full interval to warm a cold service
    const id = setInterval(ping, PING_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return null;
}
