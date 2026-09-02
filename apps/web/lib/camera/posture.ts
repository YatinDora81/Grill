import type { PostureTurnMetrics } from "@repo/types";

export interface PoseLm {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PostureFrame {
  t: number;
  headDrop: number;
  tiltDeg: number;
  handNearFace: boolean;
  wristSpeed: number | null;
  wristPos: { x: number; y: number }[];
}

export const POSTURE = {
  minVisibility: 0.5,
  slouchDelta: 0.12,
  handFaceRadius: 0.9,
  sampleHz: 3,
  minFrames: 6,
} as const;

const visible = (p: PoseLm | undefined): p is PoseLm =>
  Boolean(p) && (p as PoseLm).visibility >= POSTURE.minVisibility;

export function foldAngle(deg: number): number {
  if (deg > 90) return deg - 180;
  if (deg < -90) return deg + 180;
  return deg;
}

export function postureFrame(
  lm: ArrayLike<PoseLm>,
  t: number,
  prev: PostureFrame | null,
): PostureFrame | null {
  const nose = lm[0];
  const ls = lm[11];
  const rs = lm[12];
  if (!nose || !visible(ls) || !visible(rs)) return null;

  const width = Math.hypot(rs.x - ls.x, rs.y - ls.y) || 1e-6;
  const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const headDrop = (nose.y - mid.y) / width;
  const tiltDeg = foldAngle((Math.atan2(rs.y - ls.y, rs.x - ls.x) * 180) / Math.PI);

  const hands = [lm[15], lm[16], lm[19], lm[20]].filter(visible);
  const handNearFace = hands.some(
    (p) => Math.hypot(p.x - nose.x, p.y - nose.y) < POSTURE.handFaceRadius * width,
  );

  const wrists = [lm[15], lm[16]].filter(visible).map((p) => ({ x: p.x, y: p.y }));
  let wristSpeed: number | null = null;
  if (prev && prev.wristPos.length === wrists.length && wrists.length > 0) {
    const dt = (t - prev.t) / 1000;
    if (dt > 0) {
      const moved =
        wrists.reduce(
          (a, p, i) => a + Math.hypot(p.x - prev.wristPos[i]!.x, p.y - prev.wristPos[i]!.y),
          0,
        ) / wrists.length;
      wristSpeed = moved / width / dt;
    }
  }
  return { t, headDrop, tiltDeg, handNearFace, wristSpeed, wristPos: wrists };
}

export function medianHeadDrop(frames: PostureFrame[]): number {
  const v = frames.map((f) => f.headDrop).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

export function summarizePosture(
  frames: PostureFrame[],
  baseline: { headDrop: number; calibrated: boolean },
  sampleHz: number,
): PostureTurnMetrics | null {
  if (!baseline.calibrated || frames.length < POSTURE.minFrames) return null;
  const slouch = frames.filter((f) => f.headDrop - baseline.headDrop > POSTURE.slouchDelta).length;
  const hands = frames.filter((f) => f.handNearFace).length;
  const tilt = frames.reduce((a, f) => a + Math.abs(f.tiltDeg), 0) / frames.length;
  const speeds = frames.flatMap((f) => (f.wristSpeed === null ? [] : [f.wristSpeed]));
  const motion = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    frames: frames.length,
    slouch_pct: r1((slouch / frames.length) * 100),
    hands_to_face_pct: r1((hands / frames.length) * 100),
    shoulder_tilt_deg: r1(tilt),
    wrist_motion: Math.round(motion * 100) / 100,
    sample_hz: sampleHz,
  };
}
