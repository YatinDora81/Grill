import type { AwaySegment, CameraTurnMetrics } from "@repo/types";

export type { AwaySegment, CameraTurnMetrics };

export type PoseSource = CameraTurnMetrics["pose_source"];

export interface CameraFrame {
  t: number;
  face: boolean;
  yaw: number;
  pitch: number;
  gazeH: number;
  gazeV: number;
  smile: number;
  blink: number;
}

export interface PoseSample {
  yaw: number;
  pitch: number;
}
