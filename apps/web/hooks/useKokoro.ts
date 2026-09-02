"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KokoroIn, KokoroOut } from "@/workers/kokoro.worker";

export type KokoroState = "unsupported" | "disabled" | "idle" | "loading" | "ready" | "failed";

export interface LocalVoice {
  state: KokoroState;
  ready: boolean;
  progress: number | null;
  device: "webgpu" | "wasm" | null;
  speaking: boolean;
  speak: (text: string, voice: string, opts?: { speed?: number; onEnd?: () => void }) => boolean;
  stop: () => void;
}

const PREF_KEY = "grill.localvoice";
const MIN_DEVICE_MEMORY_GB = 4;

function supported(): boolean {
  if (
    typeof window === "undefined" ||
    typeof Worker === "undefined" ||
    typeof WebAssembly === "undefined"
  ) {
    return false;
  }
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return mem === undefined || mem >= MIN_DEVICE_MEMORY_GB;
}

export function readLocalVoicePref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeLocalVoicePref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {}
}

export function useKokoro(enabled: boolean): LocalVoice {
  const [state, setState] = useState<KokoroState>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [device, setDevice] = useState<"webgpu" | "wasm" | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nextTimeRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const idRef = useRef(0);
  const doneRef = useRef(false);
  const onEndRef = useRef<(() => void) | null>(null);

  const finishIfIdle = useCallback(() => {
    if (doneRef.current && sourcesRef.current.length === 0) {
      setSpeaking(false);
      onEndRef.current?.();
      onEndRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState("disabled");
      return;
    }
    if (!supported()) {
      setState("unsupported");
      return;
    }
    const worker = new Worker(new URL("../workers/kokoro.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    setState("loading");

    worker.onmessage = (e: MessageEvent<KokoroOut>) => {
      const msg = e.data;
      if (msg.type === "progress") setProgress(msg.progress);
      else if (msg.type === "ready") {
        setDevice(msg.device);
        setState("ready");
      } else if (msg.type === "chunk") {
        if (msg.id !== idRef.current) return;
        const ctx = ctxRef.current;
        if (!ctx) return;
        const buffer = ctx.createBuffer(1, msg.audio.length, msg.sampleRate);
        buffer.copyToChannel(msg.audio, 0);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        const at = Math.max(ctx.currentTime + 0.02, nextTimeRef.current);
        src.onended = () => {
          sourcesRef.current = sourcesRef.current.filter((s) => s !== src);
          finishIfIdle();
        };
        sourcesRef.current.push(src);
        src.start(at);
        nextTimeRef.current = at + buffer.duration;
        setSpeaking(true);
      } else if (msg.type === "done") {
        if (msg.id !== idRef.current) return;
        doneRef.current = true;
        finishIfIdle();
      } else if (msg.type === "error") {
        console.warn("[kokoro]", msg.message);
        if (msg.id === undefined) setState("failed");
        else {
          doneRef.current = true;
          finishIfIdle();
        }
      }
    };
    worker.onerror = (err) => {
      console.warn("[kokoro] worker failed:", err.message);
      setState("failed");
    };

    void (async () => {
      let dev: "webgpu" | "wasm" = "wasm";
      try {
        const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        if (gpu && (await gpu.requestAdapter())) dev = "webgpu";
      } catch {}
      worker.postMessage({ type: "load", device: dev } satisfies KokoroIn);
    })();

    return () => {
      worker.terminate();
      workerRef.current = null;
      sourcesRef.current.forEach((s) => {
        try {
          s.stop();
        } catch {}
      });
      sourcesRef.current = [];
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, [enabled, finishIfIdle]);

  const stop = useCallback(() => {
    idRef.current++;
    workerRef.current?.postMessage({ type: "cancel" } satisfies KokoroIn);
    sourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {}
    });
    sourcesRef.current = [];
    nextTimeRef.current = 0;
    onEndRef.current = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback<LocalVoice["speak"]>(
    (text, voice, opts) => {
      const worker = workerRef.current;
      if (!worker || state !== "ready" || !text.trim()) return false;
      stop();
      ctxRef.current ??= new AudioContext();
      void ctxRef.current.resume().catch(() => {});
      nextTimeRef.current = 0;
      doneRef.current = false;
      onEndRef.current = opts?.onEnd ?? null;
      const id = ++idRef.current;
      worker.postMessage({
        type: "speak",
        id,
        text,
        voice,
        speed: opts?.speed ?? 1,
      } satisfies KokoroIn);
      return true;
    },
    [state, stop],
  );

  return { state, ready: state === "ready", progress, device, speaking, speak, stop };
}
