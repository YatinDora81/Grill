"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/apiClient";

const CONSTRAINTS: MediaStreamConstraints = {
  video: { width: 640, height: 480, frameRate: 15 },
  audio: { echoCancellation: true, noiseSuppression: true },
};

const VIDEO_ONLY: MediaStreamConstraints = { video: CONSTRAINTS.video, audio: false };

const TIMESLICE_MS = 5_000;

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

const AUDIO_BITS_PER_SECOND = 64_000;

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
  stream: MediaStream | null;
  videoId: string | null;
  offsetAt: (perfTime: number) => number | null;
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

  const bufferRef = useRef<Blob[]>([]);
  const bufferedRef = useRef(0);
  const partNumberRef = useRef(1);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const finishedRef = useRef(false);
  const lostPartsRef = useRef<number[]>([]);

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
      } catch {}
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
    lostPartsRef.current.push(partNumber);
    console.warn(`[video] part ${partNumber} failed after 3 attempts`);
  }, []);

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
        chainRef.current = chainRef.current.then(() => uploadPart(part, n));
      }
    },
    [uploadPart],
  );

  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;

    const release = () => {
      const media = acquired;
      if (!media) return;
      acquired = null;
      media.getTracks().forEach((t) => t.stop());
      if (streamRef.current === media) {
        streamRef.current = null;
        setStream(null);
      }
    };

    (async () => {
      if (typeof MediaRecorder === "undefined") return setState("failed");
      setState("starting");
      let media: MediaStream;
      try {
        media = await getCameraAndMic();
      } catch (err) {
        const name = (err as DOMException)?.name;
        console.warn("[video] camera unavailable:", name);
        if (!cancelled) setState(name === "NotAllowedError" ? "denied" : "failed");
        return;
      }
      acquired = media;
      if (cancelled) {
        release();
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
        if (cancelled) {
          release();
          return;
        }
        videoIdRef.current = started.video_id;
        partBytesRef.current = started.part_bytes;
        setVideoId(started.video_id);
      } catch (err) {
        console.warn("[video] could not start recording:", err);
        release();
        if (!cancelled) setState("failed");
        return;
      }

      try {
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
        startedAtRef.current = performance.now();
        rec.start(TIMESLICE_MS);
        recorderRef.current = rec;
      } catch (err) {
        console.warn("[video] recorder unavailable:", err);
        startedAtRef.current = null;
        release();
        if (!cancelled) setState("failed");
        return;
      }
      setState("recording");
    })().catch((err) => {
      console.warn("[video] recording could not start:", err);
      release();
      if (!cancelled) setState("failed");
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId, bitsPerSecond, drain]);

  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const offsetAt = useCallback((perfTime: number) => {
    if (startedAtRef.current === null || !videoIdRef.current) return null;
    return Math.max(0, Math.round(perfTime - startedAtRef.current));
  }, []);

  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.requestData();
        rec.stop();
      });
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);

    drain(true);
    await chainRef.current;

    if (lostPartsRef.current.length) {
      console.error(`[video] parts ${lostPartsRef.current.join(", ")} lost; not completing upload`);
      setState("failed");
      return;
    }
    setState("stopped");

    if (videoIdRef.current) {
      try {
        await apiPost("/api/interview/video/complete", { video_id: videoIdRef.current });
      } catch (err) {
        console.warn("[video] complete failed; left for salvage:", err);
      }
    }
  }, [drain]);

  return { state, stream, videoId, offsetAt, finish };
}
