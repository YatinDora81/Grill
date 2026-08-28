"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "stopped" | "denied";

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

export function useRecorder(maxSeconds: number) {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [capped, setCapped] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");

  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(typeof MediaRecorder !== "undefined");
  }, []);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const takeRef = useRef<Promise<Blob | null> | null>(null);

  const teardown = useCallback(() => {
    generationRef.current += 1;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (tickRef.current !== null) clearInterval(tickRef.current);
    rafRef.current = null;
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const dropRecorder = useCallback(() => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
      dropRecorder();
    };
  }, [teardown, dropRecorder]);

  const start = useCallback(async () => {
    teardown();
    dropRecorder();
    const gen = generationRef.current;
    setError("");
    setCapped(false);
    setState("requesting");
    takeRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (gen !== generationRef.current || !mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const sample = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) {
          const d = (v - 128) / 128;
          sum += d * d;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, Math.pow(rms * 3.2, 0.7)));
        rafRef.current = requestAnimationFrame(sample);
      };
      sample();

      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      let settle: ((b: Blob | null) => void) | null = null;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunks, {
          type: rec.mimeType || "audio/webm",
        });
        if (gen === generationRef.current) {
          teardown();
          setState("stopped");
        }
        settle?.(blob.size > 0 ? blob : null);
        settle = null;
      };
      recorderRef.current = rec;
      takeRef.current = new Promise<Blob | null>((resolve) => {
        settle = resolve;
      });
      rec.start();
      setSeconds(0);
      setState("recording");

      tickRef.current = setInterval(() => {
        setSeconds((s) => {
          const next = s + 1;
          if (next >= maxSeconds && rec.state === "recording") {
            setCapped(true);
            rec.stop();
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      if (gen !== generationRef.current || !mountedRef.current) return;
      teardown();
      const name = (err as DOMException)?.name;
      setState(name === "NotAllowedError" ? "denied" : "idle");
      setError(
        name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser, or switch to typing."
          : "No microphone available. You can type your answer instead.",
      );
    }
  }, [maxSeconds, teardown, dropRecorder]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    const take = takeRef.current;
    if (!rec || !take) return Promise.resolve(null);
    if (rec.state !== "inactive") rec.stop();
    return take;
  }, []);

  const reset = useCallback(() => {
    teardown();
    dropRecorder();
    takeRef.current = null;
    setState("idle");
    setSeconds(0);
    setCapped(false);
    setError("");
  }, [teardown, dropRecorder]);

  return { state, seconds, level, error, capped, start, stop, reset, supported };
}
