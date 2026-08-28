"use client";

import { useEffect } from "react";

const PING_MS = 10_000;

export function KeepAlive() {
  useEffect(() => {
    let cancelled = false;

    const ping = () => {
      if (cancelled) return;
      void fetch("/api/health/audio", { cache: "no-store", keepalive: true }).catch(() => {});
    };

    ping();
    const id = setInterval(ping, PING_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return null;
}
