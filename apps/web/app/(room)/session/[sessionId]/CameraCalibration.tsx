"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CALIBRATION_MS } from "./useCameraMetrics";

const flagKey = (sessionId: string) => `grill.calibrated.${sessionId}`;

function alreadyCalibrated(sessionId: string): boolean {
  try {
    return sessionStorage.getItem(flagKey(sessionId)) === "1";
  } catch {
    return false;
  }
}

function remember(sessionId: string): void {
  try {
    sessionStorage.setItem(flagKey(sessionId), "1");
  } catch {}
}

const BTN =
  "border border-room-line px-2 py-1 font-mono text-[9px] tracking-[0.14em] text-room-muted uppercase transition-colors hover:border-line-strong hover:text-room-ink";

export function CameraCalibration({
  sessionId,
  calibrate,
  onDone,
}: {
  sessionId: string;
  calibrate: (ms?: number, signal?: AbortSignal) => Promise<boolean>;
  onDone: () => void;
}) {
  const total = Math.round(CALIBRATION_MS / 1000);
  const [remaining, setRemaining] = useState(total);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    remember(sessionId);
    onDone();
  }, [sessionId, onDone]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (alreadyCalibrated(sessionId)) {
      finish();
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    void calibrate(CALIBRATION_MS, controller.signal).finally(finish);
  }, [sessionId, calibrate, finish]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setRemaining((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const skip = useCallback(() => {
    abortRef.current?.abort();
    finish();
  }, [finish]);

  if (!running) return null;

  const elapsedPct = total > 0 ? ((total - remaining) / total) * 100 : 100;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-4 z-40 w-[250px] border border-line-strong bg-room-raised shadow-(--shadow-float)"
    >
      <p className="border-b border-room-line px-3 py-1.5 font-mono text-[9px] tracking-[0.16em] text-room-muted uppercase">
        One moment
      </p>
      <div className="px-3 py-3">
        <p className="text-[0.92rem] text-room-ink">Look straight at the lens.</p>
        <p className="mt-1.5 text-[0.76rem] leading-relaxed text-room-muted">
          Three seconds of your neutral pose, so “looked at the camera” is measured against you
          rather than against an average. It stays on this device.
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-mono text-[10.5px] tracking-[0.16em] text-mixed uppercase tabular">
            {remaining}s
          </span>
          <button type="button" onClick={skip} className={BTN}>
            Skip
          </button>
        </div>
        <div className="mt-2.5 h-[3px] bg-room-line" aria-hidden="true">
          <div
            className="h-full bg-mixed transition-[width] duration-1000 ease-linear"
            style={{ width: `${elapsedPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
