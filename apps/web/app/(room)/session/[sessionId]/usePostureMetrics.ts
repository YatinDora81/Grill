"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import type { PostureTurnMetrics } from "@repo/types";
import {
  POSTURE,
  medianHeadDrop,
  postureFrame,
  summarizePosture,
  type PostureFrame,
} from "@/lib/camera/posture";
import { CALIBRATION_MS, type CameraMetricsState } from "./useCameraMetrics";

const SAMPLE_HZ = POSTURE.sampleHz;

const MODEL_PATH = "/models/pose_landmarker_lite.task";
const WASM_PATH = "/mediapipe/wasm";

const MIN_CALIBRATION_SAMPLES = 5;

interface PostureBaseline {
  headDrop: number;
  calibrated: boolean;
}

export interface PostureMetrics {
  state: CameraMetricsState;
  calibrated: boolean;
  beginTake: () => void;
  endTake: () => PostureTurnMetrics | null;
  calibrate: (ms?: number, signal?: AbortSignal) => Promise<boolean>;
}

export function usePostureMetrics(stream: MediaStream | null): PostureMetrics {
  const [state, setState] = useState<CameraMetricsState>("off");
  const [calibrated, setCalibrated] = useState(false);

  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const framesRef = useRef<PostureFrame[]>([]);
  const prevFrameRef = useRef<PostureFrame | null>(null);
  const takeStartRef = useRef<number | null>(null);
  const baselineRef = useRef<PostureBaseline>({ headDrop: 0, calibrated: false });
  const calibrationRef = useRef<PostureFrame[] | null>(null);
  const lastStampRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!stream) {
      setState("off");
      return;
    }
    let cancelled = false;
    let created: PoseLandmarker | null = null;
    let element: HTMLVideoElement | null = null;
    setState("loading");

    void (async () => {
      const { PoseLandmarker: Landmarker, FilesetResolver } = await import(
        "@mediapipe/tasks-vision"
      );
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
      const make = (delegate: "GPU" | "CPU") =>
        Landmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate },
          runningMode: "VIDEO",
          numPoses: 1,
        });

      let landmarker: PoseLandmarker;
      try {
        landmarker = await make("GPU");
      } catch (err) {
        console.warn("[posture] GPU delegate unavailable; retrying on the CPU:", err);
        landmarker = await make("CPU");
      }
      created = landmarker;
      if (cancelled) {
        created = null;
        landmarker.close();
        return;
      }

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (cancelled) {
        created = null;
        landmarker.close();
        video.srcObject = null;
        return;
      }

      element = video;
      landmarkerRef.current = landmarker;
      videoRef.current = video;
      setState("ready");
    })().catch((err) => {
      console.warn("[posture] pose model unavailable; posture metrics off:", err);
      if (!cancelled) setState("failed");
    });

    return () => {
      cancelled = true;
      landmarkerRef.current = null;
      videoRef.current = null;
      framesRef.current = [];
      prevFrameRef.current = null;
      takeStartRef.current = null;
      calibrationRef.current = null;
      created?.close();
      if (element) {
        element.pause();
        element.srcObject = null;
      }
    };
  }, [stream]);

  const sample = useCallback(() => {
    const landmarker = landmarkerRef.current;
    const video = videoRef.current;
    if (!landmarker || !video) return;
    const calibration = calibrationRef.current;
    const takeStart = takeStartRef.current;
    if (takeStart === null && !calibration) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    const stamp = Math.max(performance.now(), lastStampRef.current + 1);
    lastStampRef.current = stamp;

    let result;
    try {
      result = landmarker.detectForVideo(video, stamp);
    } catch {
      return;
    }

    const lm = result.landmarks[0];
    if (!lm || lm.length === 0) return;

    const frame = postureFrame(lm, stamp - (takeStart ?? stamp), prevFrameRef.current);
    if (!frame) return;
    prevFrameRef.current = frame;

    if (calibration) calibration.push(frame);
    if (takeStart === null) return;
    framesRef.current.push(frame);
  }, []);

  useEffect(() => {
    if (state !== "ready") return;
    const id = setInterval(sample, 1000 / SAMPLE_HZ);
    return () => clearInterval(id);
  }, [state, sample]);

  const beginTake = useCallback(() => {
    framesRef.current = [];
    prevFrameRef.current = null;
    takeStartRef.current = performance.now();
  }, []);

  const endTake = useCallback((): PostureTurnMetrics | null => {
    if (takeStartRef.current === null) return null;
    takeStartRef.current = null;
    const metrics = summarizePosture(framesRef.current, baselineRef.current, SAMPLE_HZ);
    framesRef.current = [];
    prevFrameRef.current = null;
    return metrics;
  }, []);

  const calibrate = useCallback(
    async (ms = CALIBRATION_MS, signal?: AbortSignal): Promise<boolean> => {
      if (!landmarkerRef.current || !videoRef.current) return false;
      if (calibrationRef.current) return false;

      const samples: PostureFrame[] = [];
      calibrationRef.current = samples;
      try {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, ms);
          if (signal?.aborted) finish();
          else signal?.addEventListener("abort", finish, { once: true });
        });
      } finally {
        calibrationRef.current = null;
      }

      if (signal?.aborted) return false;

      if (samples.length < MIN_CALIBRATION_SAMPLES) {
        console.warn("[posture] too little of the body in frame to set a baseline; posture off");
        return false;
      }
      baselineRef.current = { headDrop: medianHeadDrop(samples), calibrated: true };
      if (mountedRef.current) setCalibrated(true);
      return true;
    },
    [],
  );

  return { state, calibrated, beginTake, endTake, calibrate };
}
