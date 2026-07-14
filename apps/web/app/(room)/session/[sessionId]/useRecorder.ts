"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * MediaRecorder + a live input level, for the hot seat.
 *
 * The level comes from an AnalyserNode on the real mic stream — it is the actual
 * signal, not an animation. If the meter is flat, the mic genuinely isn't
 * picking you up, which is worth knowing BEFORE you spend 90 seconds answering.
 */
export type RecorderState = "idle" | "requesting" | "recording" | "stopped" | "denied";

/** Browsers disagree on container support; pick the first the engine admits to. */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

export function useRecorder(maxSeconds: number) {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");

  /**
   * `typeof MediaRecorder` must not be read during render: it's undefined on
   * the server and defined in the browser, so the two passes disagree and React
   * discards the whole hot seat and rebuilds it (a real hydration error).
   * Assume support — the overwhelmingly common case, and the right thing for
   * SSR to paint — then correct on mount for the browsers that lack it.
   */
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(typeof MediaRecorder !== "undefined");
  }, []);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((b: Blob | null) => void) | null>(null);

  const teardown = useCallback(() => {
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

  // Release the mic if the user navigates away mid-answer — a hot mic left open
  // is both a privacy problem and a battery one.
  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    setError("");
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      // A context built without a live user gesture starts suspended, and a
      // suspended context's analyser reports pure silence — a meter frozen flat
      // while the mic is genuinely recording. The gesture that got us here is
      // often already spent: `getUserMedia` above can sit on a permission prompt
      // for longer than the activation lasts.
      // Never awaited: `resume()` can hang indefinitely when the OS hands back
      // no usable output device, and blocking here would wedge the whole start
      // path — no recording at all, because the meter couldn't wake up. The
      // meter is decoration; the recording is the point. It catches up on its
      // own the moment the context runs.
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
        // RMS, then a gentle curve so normal speech uses most of the meter.
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, Math.pow(rms * 3.2, 0.7)));
        rafRef.current = requestAnimationFrame(sample);
      };
      sample();

      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        teardown();
        setState("stopped");
        resolveRef.current?.(blob.size > 0 ? blob : null);
        resolveRef.current = null;
      };
      recorderRef.current = rec;
      rec.start();
      setSeconds(0);
      setState("recording");

      tickRef.current = setInterval(() => {
        setSeconds((s) => {
          const next = s + 1;
          // Hard stop at the server's limit rather than letting the upload 413.
          if (next >= maxSeconds && rec.state === "recording") rec.stop();
          return next;
        });
      }, 1000);
    } catch (err) {
      teardown();
      const name = (err as DOMException)?.name;
      setState(name === "NotAllowedError" ? "denied" : "idle");
      setError(
        name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser, or switch to typing."
          : "No microphone available. You can type your answer instead.",
      );
    }
  }, [maxSeconds, teardown]);

  /** Stop and resolve with the recorded audio (null if nothing was captured). */
  const stop = useCallback(() => {
    return new Promise<Blob | null>((resolve) => {
      const rec = recorderRef.current;
      if (!rec || rec.state !== "recording") {
        resolve(null);
        return;
      }
      resolveRef.current = resolve;
      rec.stop();
    });
  }, []);

  const reset = useCallback(() => {
    teardown();
    setState("idle");
    setSeconds(0);
    setError("");
  }, [teardown]);

  return { state, seconds, level, error, start, stop, reset, supported };
}
