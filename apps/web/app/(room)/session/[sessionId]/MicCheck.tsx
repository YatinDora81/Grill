"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { assessMic, type MicAssessment } from "@/lib/audio/micCheck";

const QUIET_MS = 1_500;
const SPEAK_MS = 4_000;
const TICK_MS = 50;
const CLIP_LEVEL = 0.98;
const SPEECH_PERCENTILE = 0.9;
const FFT_SIZE = 2048;

export const MIC_CHECK_LINE = "I'd start by measuring, then decide.";

const flagKey = (sessionId: string) => `grill.miccheck.${sessionId}`;

export function micAlreadyChecked(sessionId: string): boolean {
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

type Step = "quiet" | "speak" | "done";

const STEP_LABEL: Record<Step, string> = {
  quiet: "Mic check · 1 of 2",
  speak: "Mic check · 2 of 2",
  done: "Mic check",
};

const VERDICT_TONE = {
  good: "text-strong",
  quiet: "text-mixed",
  noisy: "text-mixed",
  clipping: "text-weak",
} as const;

interface LevelWindow {
  rms: number[];
  clipped: number;
  samples: number;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

async function listen(
  analyser: AnalyserNode,
  ms: number,
  signal: AbortSignal,
): Promise<LevelWindow> {
  const buf = new Float32Array(analyser.fftSize);
  const rms: number[] = [];
  let clipped = 0;
  let samples = 0;
  const deadline = performance.now() + ms;

  while (performance.now() < deadline && !signal.aborted) {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) {
      sum += v * v;
      if (Math.abs(v) >= CLIP_LEVEL) clipped++;
    }
    samples += buf.length;
    rms.push(Math.sqrt(sum / buf.length));
    await sleep(TICK_MS, signal);
  }
  return { rms, clipped, samples };
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
  return sorted[i]!;
}

export function MicCheck({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [step, setStep] = useState<Step>("quiet");
  const [assessment, setAssessment] = useState<MicAssessment | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const startedRef = useRef(false);
  const doneRef = useRef(false);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    abortRef.current?.abort();
    release();
    remember(sessionId);
    onDone();
  }, [sessionId, onDone, release]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    void (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      if (signal.aborted) return release();

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      await ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const quiet = await listen(analyser, QUIET_MS, signal);
      if (signal.aborted) return release();
      setStep("speak");

      const spoken = await listen(analyser, SPEAK_MS, signal);
      if (signal.aborted) return release();

      release();
      setAssessment(
        assessMic({
          noiseRms: quantile(quiet.rms, 0.5),
          speechRms: quantile(spoken.rms, SPEECH_PERCENTILE),
          clippedFraction: spoken.samples > 0 ? spoken.clipped / spoken.samples : 0,
        }),
      );
      setStep("done");
    })().catch((err) => {
      console.warn("[miccheck] could not listen to the microphone; skipping the check:", err);
      finish();
    });
  }, [release, finish]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      release();
    };
  }, [release]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-6 z-40 w-[250px] border border-line-strong bg-room-raised shadow-(--shadow-float)"
    >
      <p className="border-b border-room-line px-3 py-1.5 font-mono text-[9px] tracking-[0.16em] text-room-muted uppercase">
        {STEP_LABEL[step]}
      </p>
      <div className="px-3 py-3">
        {step === "quiet" ? (
          <>
            <p className="text-[0.92rem] text-room-ink">Stay quiet for a moment.</p>
            <p className="mt-1.5 text-[0.76rem] leading-relaxed text-room-muted">
              Measuring the room behind your voice, so the tone numbers are worth reading. Nothing is
              recorded and nothing is uploaded.
            </p>
          </>
        ) : null}

        {step === "speak" ? (
          <>
            <p className="text-[0.92rem] text-room-ink">Read this line out loud:</p>
            <p className="mt-1.5 text-[0.86rem] leading-relaxed text-room-ink italic">
              {MIC_CHECK_LINE}
            </p>
          </>
        ) : null}

        {step === "done" && assessment ? (
          <>
            <p className={`text-[0.92rem] ${VERDICT_TONE[assessment.verdict]}`}>
              {assessment.message}
            </p>
            <p className="mt-1.5 font-mono text-[9px] tracking-[0.14em] text-room-muted uppercase">
              {assessment.snrDb === null
                ? "signal to noise · not measurable"
                : `signal to noise · ${assessment.snrDb} db`}
            </p>
          </>
        ) : null}

        <div className="mt-3 flex items-center justify-end gap-3">
          {step === "done" ? (
            <button type="button" onClick={finish} className={BTN}>
              Continue
            </button>
          ) : (
            <button type="button" onClick={finish} className={BTN}>
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
