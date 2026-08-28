import type { AwaySegment, CameraFrame, CameraTurnMetrics, PoseSample, PoseSource } from "./types";

export const CAMERA_THRESHOLDS = {
  gaze: 0.35,
  yawDeg: 15,
  pitchDeg: 15,
  smile: 0.3,
  blink: 0.5,
  awayMinMs: 600,
  awayMergeGapMs: 300,
} as const;

export type CameraThresholds = typeof CAMERA_THRESHOLDS;

export const CAMERA_METRIC_KEYS = [
  "frames",
  "no_face_frames",
  "on_camera_pct",
  "smile_pct",
  "head_motion_dps",
  "away_segments",
  "longest_away_ms",
  "sample_hz",
  "pose_source",
] as const satisfies readonly (keyof CameraTurnMetrics)[];

export const AWAY_SEGMENT_KEYS = ["start_ms", "end_ms"] as const satisfies readonly (keyof AwaySegment)[];

export interface FrameVerdict {
  onCamera: boolean;
  smiling: boolean;
  usable: boolean;
}

export function classifyFrame(f: CameraFrame, th: CameraThresholds = CAMERA_THRESHOLDS): FrameVerdict {
  if (!f.face) return { onCamera: false, smiling: false, usable: false };
  if (f.blink > th.blink) return { onCamera: true, smiling: f.smile > th.smile, usable: false };
  const onCamera =
    f.gazeH < th.gaze &&
    f.gazeV < th.gaze &&
    Math.abs(f.yaw) < th.yawDeg &&
    Math.abs(f.pitch) < th.pitchDeg;
  return { onCamera, smiling: f.smile > th.smile, usable: true };
}

export function mergeAwaySegments(
  raw: AwaySegment[],
  th: CameraThresholds = CAMERA_THRESHOLDS,
): AwaySegment[] {
  const sorted = [...raw].sort((a, b) => a.start_ms - b.start_ms);
  const out: AwaySegment[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start_ms - last.end_ms <= th.awayMergeGapMs) {
      last.end_ms = Math.max(last.end_ms, s.end_ms);
    } else {
      out.push({ start_ms: s.start_ms, end_ms: s.end_ms });
    }
  }
  return out.filter((s) => s.end_ms - s.start_ms >= th.awayMinMs);
}

export function summarizeTurn(
  frames: CameraFrame[],
  sampleHz: number,
  poseSource: PoseSource,
  th: CameraThresholds = CAMERA_THRESHOLDS,
): CameraTurnMetrics | null {
  const faceFrames = frames.filter((f) => f.face);
  if (faceFrames.length < sampleHz * 2) return null;

  let usable = 0;
  let on = 0;
  let smiling = 0;
  const away: AwaySegment[] = [];
  let awayStart: number | null = null;
  let motionSum = 0;
  let motionN = 0;
  let prev: CameraFrame | null = null;

  for (const f of frames) {
    const c = classifyFrame(f, th);
    if (c.usable) {
      usable++;
      if (c.onCamera) on++;
    }
    if (f.face && c.smiling) smiling++;

    const isAway = !f.face || (c.usable && !c.onCamera);
    if (isAway && awayStart === null) awayStart = f.t;
    if (!isAway && c.usable && awayStart !== null) {
      away.push({ start_ms: awayStart, end_ms: f.t });
      awayStart = null;
    }

    if (prev && f.face && prev.face) {
      const dt = (f.t - prev.t) / 1000;
      if (dt > 0) {
        motionSum += (Math.abs(f.yaw - prev.yaw) + Math.abs(f.pitch - prev.pitch)) / dt;
        motionN++;
      }
    }
    if (f.face) prev = f;
  }
  const lastFrame = frames[frames.length - 1];
  if (awayStart !== null && lastFrame) away.push({ start_ms: awayStart, end_ms: lastFrame.t });

  if (usable === 0) return null;

  const merged = mergeAwaySegments(away, th);
  return {
    frames: faceFrames.length,
    no_face_frames: frames.length - faceFrames.length,
    on_camera_pct: round1((on / usable) * 100),
    smile_pct: round1((smiling / faceFrames.length) * 100),
    head_motion_dps: motionN ? round1(motionSum / motionN) : 0,
    away_segments: merged,
    longest_away_ms: merged.reduce((m, s) => Math.max(m, s.end_ms - s.start_ms), 0),
    sample_hz: sampleHz,
    pose_source: poseSource,
  };
}

export interface EulerAngles {
  yaw: number;
  pitch: number;
  roll: number;
}

export function eulerFromMatrix(m: ArrayLike<number>): EulerAngles {
  const r00 = m[0] ?? 1;
  const r10 = m[1] ?? 0;
  const r20 = m[2] ?? 0;
  const r21 = m[6] ?? 0;
  const r22 = m[10] ?? 1;
  const deg = (r: number) => {
    const d = (r * 180) / Math.PI;
    return d === 0 ? 0 : d;
  };
  return {
    yaw: deg(Math.atan2(-r20, Math.hypot(r00, r10))),
    pitch: deg(Math.atan2(r21, r22)),
    roll: deg(Math.atan2(r10, r00)),
  };
}

export function landmarkPoseProxy(lm: ArrayLike<{ x: number; y: number }>): PoseSample {
  const nose = lm[1];
  const le = lm[33];
  const re = lm[263];
  if (!nose || !le || !re) return { yaw: 0, pitch: 0 };
  const mid = { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 };
  const iod = Math.hypot(le.x - re.x, le.y - re.y) || 1e-6;
  return { yaw: ((nose.x - mid.x) / iod) * 60, pitch: ((nose.y - mid.y) / iod) * 60 };
}

export function medianPose(samples: PoseSample[]): PoseSample {
  if (samples.length === 0) return { yaw: 0, pitch: 0 };
  return { yaw: median(samples.map((s) => s.yaw)), pitch: median(samples.map((s) => s.pitch)) };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface AwayBlock {
  start_ms: number;
  end_ms: number;
  leftPct: number;
  widthPct: number;
}

export const AWAY_BLOCK_MIN_PCT = 1.2;

export function awayBlocks(segments: AwaySegment[], totalMs: number): AwayBlock[] {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return [];
  const blocks: AwayBlock[] = [];
  for (const s of segments) {
    const start = clamp(s.start_ms, 0, totalMs);
    const end = clamp(s.end_ms, 0, totalMs);
    if (end <= start) continue;
    const leftPct = (start / totalMs) * 100;
    const widthPct = Math.max(AWAY_BLOCK_MIN_PCT, ((end - start) / totalMs) * 100);
    blocks.push({
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      leftPct: round1(leftPct),
      widthPct: round1(Math.min(widthPct, 100 - leftPct)),
    });
  }
  return blocks;
}

export function takeMs(lastWordEndSeconds: number | null, segments: AwaySegment[]): number {
  const fromWords = lastWordEndSeconds !== null ? Math.round(lastWordEndSeconds * 1000) : 0;
  const fromSegments = segments.reduce((m, s) => Math.max(m, s.end_ms), 0);
  return Math.max(fromWords, fromSegments);
}

export function formatAwayDuration(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

export function formatTakeOffset(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const round1 = (n: number) => Math.round(n * 10) / 10;
