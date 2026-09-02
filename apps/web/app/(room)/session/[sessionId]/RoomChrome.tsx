"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/apiClient";
import { THEME_ATTR, THEME_EVENT, type Theme } from "@/components/theme";
import type { VideoState } from "./useSessionVideo";

const MAX_SEGMENTS = 24;

const REDIRECT_MS = 5_000;

const MARK_C = 2 * Math.PI * 30;

const LEAVE_CANCEL_WAIT_MS = 2_500;

export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="mx-0.5 border border-line px-1 py-px font-mono text-[9.5px] text-ink-soft">
      {children}
    </kbd>
  );
}

export function Progress({ answered, total }: { answered: number; total: number }) {
  if (total > MAX_SEGMENTS) {
    return (
      <div className="rprog" aria-hidden="true">
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${(answered / total) * 100}%` }} />
        </div>
      </div>
    );
  }
  return (
    <div className="rprog" aria-hidden="true">
      <div className="segs">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className="seg-i" data-done={i < answered} data-live={i === answered} />
        ))}
      </div>
    </div>
  );
}

export function RecDot({ state }: { state: VideoState }) {
  if (state === "starting") {
    return <span className="rec-chip">CAM…</span>;
  }
  if (state === "denied" || state === "failed") {
    return (
      <span
        className="rec-chip"
        title={
          state === "denied"
            ? "Camera blocked — the interview still works, but the replay will have no video."
            : "Camera unavailable — the interview still works, but the replay will have no video."
        }
      >
        NO CAM
      </span>
    );
  }
  if (state !== "recording") return null;
  return (
    <span className="rec-chip" title="This interview is being recorded">
      <span aria-hidden="true" className="rec-dot animate-pulse-rec" />
      REC
    </span>
  );
}

export function DoneMark() {
  return (
    <svg
      className="done-mark"
      viewBox="0 0 72 72"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="36" cy="36" r="30" className="dmark-disc" />
      <circle
        cx="36"
        cy="36"
        r="30"
        className="dmark-arc"
        style={{ "--c": MARK_C } as CSSProperties}
        transform="rotate(-90 36 36)"
      />
      <path className="dmark-check" d="M24.5 37.5 L32.5 45 L48 28.5" pathLength={100} />
    </svg>
  );
}

export function ThankYou({ sessionId, saving }: { sessionId: string; saving: Promise<void> | null }) {
  const router = useRouter();
  const [flushing, setFlushing] = useState(Boolean(saving));

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const leave = () => {
      if (!cancelled) timer = setTimeout(() => router.push("/dashboard"), REDIRECT_MS);
    };
    if (!saving) {
      setFlushing(false);
      leave();
    } else {
      void saving.then(() => {
        if (cancelled) return;
        setFlushing(false);
        leave();
      });
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [saving, router]);

  return (
    <div className="done">
      <div className="grain" aria-hidden="true" />
      <div className="done-glow" aria-hidden="true" />
      <div className="done-in animate-rise">
        <DoneMark />
        <h1 className="done-h">That&apos;s the interview.</h1>
        <p className="done-sub">
          {flushing
            ? "Saving the last of your recording — this only takes a moment."
            : "You can close this — we're scoring every answer and measuring how you sounded. Your report will be waiting on the dashboard."}
        </p>
        <div className="done-btns">
          <button onClick={() => router.push(`/report/${sessionId}`)} className="btn btn-primary">
            Wait for the report
          </button>
          <button onClick={() => router.push("/dashboard")} className="underlink">
            Go to the dashboard now
          </button>
        </div>
      </div>
    </div>
  );
}

export function useRoomTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute(THEME_ATTR) === "light" ? "light" : "dark");
    read();
    window.addEventListener(THEME_EVENT, read);
    return () => window.removeEventListener(THEME_EVENT, read);
  }, []);
  return theme;
}

export function fmtTime(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function useQuit(sessionId: string, cleanup: () => void): () => Promise<void> {
  const router = useRouter();
  const clean = useRef(cleanup);
  clean.current = cleanup;

  return useCallback(async () => {
    if (!confirm("Leave this interview? It won't be scored.")) return;
    clean.current();
    await Promise.race([
      apiPost("/api/interview/cancel", { session_id: sessionId }).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, LEAVE_CANCEL_WAIT_MS)),
    ]);
    router.push("/dashboard");
  }, [sessionId, router]);
}
