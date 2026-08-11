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
  const [capped, setCapped] = useState(false);
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
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  /**
   * The take is promised from the moment recording starts, not from the moment
   * someone asks for it: the cap stops the recorder on its own schedule, and a
   * promise created later would have missed the only `onstop` there is.
   */
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

  // Release the mic if the user navigates away mid-answer — a hot mic left open
  // is both a privacy problem and a battery one.
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
    // Drop the previous take up front: if this start never reaches a recorder,
    // `stop()` must not hand back the last one.
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
          // Hard stop at the server's limit rather than letting the upload 413.
          if (next >= maxSeconds && rec.state === "recording") {
            // Say so, don't just stop. Stopping flips `state` to "stopped",
            // which is also what a manual stop looks like mid-submit — and the
            // room's only submit button is rendered on `state === "recording"`,
            // so it vanishes at the same instant. Without a signal that names the
            // cap as the cause, a capped answer finishes and is never sent.
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

  /** Stop and resolve with the recorded audio (null if nothing was captured). */
  const stop = useCallback(() => {
    const rec = recorderRef.current;
    const take = takeRef.current;
    if (!rec || !take) return Promise.resolve(null);
    // Already inactive means the cap got here first; the take it produced is
    // waiting on this same promise.
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
