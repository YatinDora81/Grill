"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import {
  eulerFromMatrix,
  landmarkPoseProxy,
  medianPose,
  summarizeTurn,
} from "@/lib/camera/summarize";
import type { CameraFrame, CameraTurnMetrics, PoseSample, PoseSource } from "@/lib/camera/types";

const SAMPLE_HZ = 5;

const MODEL_PATH = "/models/face_landmarker.task";
const WASM_PATH = "/mediapipe/wasm";

export const CALIBRATION_MS = 3_000;

const MIN_CALIBRATION_SAMPLES = 5;

export type CameraMetricsState = "off" | "loading" | "ready" | "failed";

export interface CameraMetrics {
  state: CameraMetricsState;
  calibrated: boolean;
  beginTake: () => void;
  endTake: () => CameraTurnMetrics | null;
  calibrate: (ms?: number, signal?: AbortSignal) => Promise<boolean>;
}

export function useCameraMetrics(stream: MediaStream | null): CameraMetrics {
  const [state, setState] = useState<CameraMetricsState>("off");
  const [calibrated, setCalibrated] = useState(false);

  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const framesRef = useRef<CameraFrame[]>([]);
  const takeStartRef = useRef<number | null>(null);
  const baselineRef = useRef<PoseSample>({ yaw: 0, pitch: 0 });
  const poseSourceRef = useRef<PoseSource>("matrix");
  const calibrationRef = useRef<PoseSample[] | null>(null);
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
    let created: FaceLandmarker | null = null;
    let element: HTMLVideoElement | null = null;
    setState("loading");

    void (async () => {
      const { FaceLandmarker: Landmarker, FilesetResolver } = await import(
        "@mediapipe/tasks-vision"
      );
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
      const make = (delegate: "GPU" | "CPU") =>
        Landmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });

      let landmarker: FaceLandmarker;
      try {
        landmarker = await make("GPU");
      } catch (err) {
        console.warn("[camera] GPU delegate unavailable; retrying on the CPU:", err);
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
      console.warn("[camera] face model unavailable; on-camera metrics off:", err);
      if (!cancelled) setState("failed");
    });

    return () => {
      cancelled = true;
      landmarkerRef.current = null;
      videoRef.current = null;
      framesRef.current = [];
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

    const face = result.faceLandmarks[0];
    if (!face || face.length === 0) {
      if (takeStart !== null) {
        framesRef.current.push({
          t: stamp - takeStart,
          face: false,
          yaw: 0,
          pitch: 0,
          gazeH: 0,
          gazeV: 0,
          smile: 0,
          blink: 0,
        });
      }
      return;
    }

    const matrix = result.facialTransformationMatrixes[0]?.data;
    let pose: PoseSample;
    if (matrix && matrix.length === 16) {
      const { yaw, pitch } = eulerFromMatrix(matrix);
      pose = { yaw, pitch };
      poseSourceRef.current = "matrix";
    } else {
      pose = landmarkPoseProxy(face);
      poseSourceRef.current = "landmarks";
    }

    if (calibration) calibration.push(pose);
    if (takeStart === null) return;

    const scores = new Map(
      result.faceBlendshapes[0]?.categories.map((c) => [c.categoryName, c.score]) ?? [],
    );
    const g = (name: string) => scores.get(name) ?? 0;
    const baseline = baselineRef.current;

    framesRef.current.push({
      t: stamp - takeStart,
      face: true,
      yaw: pose.yaw - baseline.yaw,
      pitch: pose.pitch - baseline.pitch,
      gazeH: Math.max(
        g("eyeLookInLeft"),
        g("eyeLookOutLeft"),
        g("eyeLookInRight"),
        g("eyeLookOutRight"),
      ),
      gazeV: Math.max(
        g("eyeLookUpLeft"),
        g("eyeLookUpRight"),
        g("eyeLookDownLeft"),
        g("eyeLookDownRight"),
      ),
      smile: (g("mouthSmileLeft") + g("mouthSmileRight")) / 2,
      blink: Math.max(g("eyeBlinkLeft"), g("eyeBlinkRight")),
    });
  }, []);

  useEffect(() => {
    if (state !== "ready") return;
    const id = setInterval(sample, 1000 / SAMPLE_HZ);
    return () => clearInterval(id);
  }, [state, sample]);

  const beginTake = useCallback(() => {
    framesRef.current = [];
    takeStartRef.current = performance.now();
  }, []);

  const endTake = useCallback((): CameraTurnMetrics | null => {
    if (takeStartRef.current === null) return null;
    takeStartRef.current = null;
    const metrics = summarizeTurn(framesRef.current, SAMPLE_HZ, poseSourceRef.current);
    framesRef.current = [];
    return metrics;
  }, []);

  const calibrate = useCallback(async (ms = CALIBRATION_MS, signal?: AbortSignal): Promise<boolean> => {
    if (!landmarkerRef.current || !videoRef.current) return false;
    if (calibrationRef.current) return false;

    const samples: PoseSample[] = [];
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
      console.warn("[camera] too little face to set a neutral pose; measuring without one");
      return false;
    }
    baselineRef.current = medianPose(samples);
    if (mountedRef.current) setCalibrated(true);
    return true;
  }, []);

  return { state, calibrated, beginTake, endTake, calibrate };
}
