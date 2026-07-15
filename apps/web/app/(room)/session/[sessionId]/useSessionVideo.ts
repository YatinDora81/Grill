"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/apiClient";

/**
 * The session camera recording.
 *
 * ONE continuous recording for the whole interview, uploaded to R2 in 5 MiB
 * parts straight from the browser. It cannot go through our own server: a Vercel
 * function's request body caps at 4.5 MB and R2's minimum part is 5 MiB, so a
 * part is by definition too big to pass through.
 *
 * Always-on, with no in-app switch — but the browser's permission prompt is not
 * ours to bypass. A denial is not an error here: the interview carries on and
 * the replay simply has no picture.
 *
 * Camera ownership lives HERE rather than in SelfView, which used to call
 * getUserMedia and stop the tracks on unmount. If it still did, closing the
 * picture-in-picture would silently end the recording.
 */

/**
 * Picture AND sound, so the replay is one file you can just watch.
 *
 * The mic is captured a second time here, independently of useRecorder's
 * per-answer capture. That is deliberate and is NOT the "two MediaRecorders
 * fighting over one track" problem this file used to warn about: each recorder
 * owns a track from its own getUserMedia call, which browsers are happy to
 * hand out concurrently. useRecorder's audio remains the only thing that gets
 * transcribed and scored — this copy exists purely so the video has sound.
 *
 * echoCancellation matches useRecorder's settings and keeps the interviewer's
 * TTS from feeding back in off the speakers; on speakers it also means the
 * questions themselves are largely cancelled out of the recording. The video is
 * a record of the candidate, not of the conversation.
 */
const CONSTRAINTS: MediaStreamConstraints = {
  video: { width: 640, height: 480, frameRate: 15 },
  audio: { echoCancellation: true, noiseSuppression: true },
};

/** The fallback when a mic can't be had. A machine with no microphone must
 *  still get a picture — silent video is the old behaviour, not a failure. */
const VIDEO_ONLY: MediaStreamConstraints = { video: CONSTRAINTS.video, audio: false };

/** How often MediaRecorder hands us a chunk. Small enough that a crash loses
 *  seconds, large enough not to thrash. */
const TIMESLICE_MS = 5_000;

// Audio codec named explicitly: asking for bare "vp9" and handing the recorder a
// stream that also has a mic track leaves the audio codec to the browser's
// discretion, and the point of this list is not to leave that to chance.
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

/** Opus at speech quality. Named rather than left to the browser so the mic
 *  track can't quietly cost more uplink than the picture does. */
const AUDIO_BITS_PER_SECOND = 64_000;

/**
 * Camera + mic, falling back to camera alone.
 *
 * A machine with a camera but no usable mic (unplugged headset, mic already
 * held exclusively by something else) throws NotFoundError/NotReadableError for
 * the *combined* request — which would cost us the picture too. Silent video is
 * strictly better than no video, so that case retries video-only.
 *
 * A NotAllowedError is left to the caller: the prompt covers both devices, so a
 * denial is a denial and retrying just prompts again.
 */
async function getCameraAndMic(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
  } catch (err) {
    if ((err as DOMException)?.name === "NotAllowedError") throw err;
    console.warn("[video] no mic; recording video only:", (err as DOMException)?.name);
    return navigator.mediaDevices.getUserMedia(VIDEO_ONLY);
  }
}

export type VideoState = "idle" | "starting" | "recording" | "denied" | "failed" | "stopped";

export interface SessionVideo {
  state: VideoState;
  /** The live camera stream, for SelfView to display. Never stopped by SelfView. */
  stream: MediaStream | null;
  videoId: string | null;
  /**
   * Convert a `performance.now()` reading into an offset from the start of the
   * recording, or null if there is no recording.
   *
   * Takes a timestamp rather than stamping "now" because the moment that matters
   * — the question appearing — is not the moment we ask. Question 1 in
   * particular lands while getUserMedia is still resolving, so stamping at ask
   * time would give it no offset at all.
   */
  offsetAt: (perfTime: number) => number | null;
  /** Stop, flush the tail, and stitch the object. Safe to call more than once. */
  finish: () => Promise<void>;
}

export function useSessionVideo(sessionId: string, bitsPerSecond: number): SessionVideo {
  const [state, setState] = useState<VideoState>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const partBytesRef = useRef<number>(5 * 1024 * 1024);

  /** Chunks not yet part of a full part. */
  const bufferRef = useRef<Blob[]>([]);
  const bufferedRef = useRef(0);
  const partNumberRef = useRef(1);
  /** Uploads are serialised through this: parts must arrive in order. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const finishedRef = useRef(false);

  /** PUT one part straight to R2. Retries — a lost part is a corrupt file. */
  const uploadPart = useCallback(async (blob: Blob, partNumber: number) => {
    const id = videoIdRef.current;
    if (!id) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { url } = await apiPost<{ url: string }>("/api/interview/video/part-url", {
          video_id: id,
          part_number: partNumber,
        });
        const res = await fetch(url, { method: "PUT", body: blob });
        if (res.ok) return;
      } catch {
        /* fall through to the backoff */
      }
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
    console.warn(`[video] part ${partNumber} failed after 3 attempts`);
  }, []);

  /**
   * Queue whole parts out of the buffer.
   *
   * R2 requires every part except the last to be exactly the same size — stricter
   * than S3, which tolerates any size above the minimum. So while recording this
   * only ever cuts full `size` parts and leaves the remainder buffered, however
   * long it sits. `force` is the end of the recording: the leftover goes up as
   * the final part, which is the one part allowed to be short.
   */
  const drain = useCallback(
    (force: boolean) => {
      const size = partBytesRef.current;
      while (bufferedRef.current > 0 && (force || bufferedRef.current >= size)) {
        const take = Math.min(size, bufferedRef.current);
        const whole = new Blob(bufferRef.current);
        bufferRef.current = [];
        bufferedRef.current = 0;

        const part = whole.slice(0, take);
        const rest = whole.slice(take);
        if (rest.size) {
          bufferRef.current = [rest];
          bufferedRef.current = rest.size;
        }

        const n = partNumberRef.current++;
        // Serialised: parts must reach R2 in order, and a burst of parallel PUTs
        // is also the fastest way to saturate a candidate's uplink mid-answer.
        chainRef.current = chainRef.current.then(() => uploadPart(part, n));
      }
    },
    [uploadPart],
  );

  // Start on mount, once per session.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (typeof MediaRecorder === "undefined") return setState("failed");
      setState("starting");
      let media: MediaStream;
      try {
        media = await getCameraAndMic();
      } catch (err) {
        // Denied or no camera. NOT an error state for the interview — the whole
        // point of "always record" is that it never blocks anything.
        const name = (err as DOMException)?.name;
        console.warn("[video] camera unavailable:", name);
        if (!cancelled) setState(name === "NotAllowedError" ? "denied" : "failed");
        return;
      }
      if (cancelled) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = media;
      setStream(media);

      const mimeType = pickMimeType();
      try {
        const started = await apiPost<{ video_id: string; part_bytes: number }>(
          "/api/interview/video/start",
          { session_id: sessionId, mime_type: mimeType ?? "video/webm" },
        );
        if (cancelled) return;
        videoIdRef.current = started.video_id;
        partBytesRef.current = started.part_bytes;
        setVideoId(started.video_id);
      } catch (err) {
        console.warn("[video] could not start recording:", err);
        if (!cancelled) setState("failed");
        return;
      }

      const rec = new MediaRecorder(media, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: bitsPerSecond,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        bufferRef.current.push(e.data);
        bufferedRef.current += e.data.size;
        drain(false);
      };
      recorderRef.current = rec;
      // The clock starts with the recorder, and every answer offset is measured
      // against it. performance.now() rather than Date.now(): monotonic, so a
      // clock adjustment mid-interview can't shift the offsets.
      startedAtRef.current = performance.now();
      rec.start(TIMESLICE_MS);
      setState("recording");
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, bitsPerSecond, drain]);

  // Release the camera if the room unmounts without a finish() — navigating away
  // mid-interview must not leave the light on.
  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const offsetAt = useCallback((perfTime: number) => {
    if (startedAtRef.current === null || !videoIdRef.current) return null;
    // Clamped at 0: a question shown before the recording started is at the very
    // beginning of the footage, not at a negative time.
    return Math.max(0, Math.round(perfTime - startedAtRef.current));
  }, []);

  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      // requestData first: without it the tail since the last timeslice is lost.
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.requestData();
        rec.stop();
      });
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setState("stopped");

    drain(true);
    await chainRef.current;

    if (videoIdRef.current) {
      try {
        await apiPost("/api/interview/video/complete", { video_id: videoIdRef.current });
      } catch (err) {
        // The row keeps its uploadId, so /video/start on a later session or the
        // cancel path can still salvage the parts already in R2.
        console.warn("[video] complete failed; left for salvage:", err);
      }
    }
  }, [drain]);

  return { state, stream, videoId, offsetAt, finish };
}
