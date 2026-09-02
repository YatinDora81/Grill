import { describe, expect, test } from "bun:test";
import {
  POSTURE,
  medianHeadDrop,
  postureFrame,
  summarizePosture,
  type PoseLm,
  type PostureFrame,
} from "./posture";

const LANDMARKS = 33;

function body(over: Record<number, Partial<PoseLm>> = {}): PoseLm[] {
  const lm: PoseLm[] = Array.from({ length: LANDMARKS }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0,
  }));
  lm[0] = { x: 0.5, y: 0.3, z: 0, visibility: 1 };
  lm[11] = { x: 0.6, y: 0.5, z: 0, visibility: 1 };
  lm[12] = { x: 0.4, y: 0.5, z: 0, visibility: 1 };
  for (const [i, patch] of Object.entries(over)) {
    lm[Number(i)] = { ...lm[Number(i)]!, ...patch };
  }
  return lm;
}

function frames(n: number, over: Partial<PostureFrame> = {}): PostureFrame[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 333,
    headDrop: 0,
    tiltDeg: 0,
    handNearFace: false,
    wristSpeed: null,
    wristPos: [],
    ...over,
  }));
}

describe("postureFrame", () => {
  test("shoulders level across the frame read as no tilt, whichever side each one lands on", () => {
    expect(postureFrame(body(), 0, null)!.tiltDeg).toBe(0);
    expect(postureFrame(body({ 11: { x: 0.4 }, 12: { x: 0.6 } }), 0, null)!.tiltDeg).toBe(0);
  });

  test("a dropped shoulder is a signed angle, and never the 180° the raw arctangent would give", () => {
    const tilted = postureFrame(body({ 12: { y: 0.7 } }), 0, null)!;
    expect(Math.abs(tilted.tiltDeg)).toBeCloseTo(45, 5);
    expect(Math.abs(tilted.tiltDeg)).toBeLessThanOrEqual(90);
  });

  test("head drop is measured in shoulder-widths, so sitting further back does not read as slouching", () => {
    const near = postureFrame(body(), 0, null)!;
    const far = postureFrame(
      body({ 0: { x: 0.5, y: 0.4 }, 11: { x: 0.55 }, 12: { x: 0.45 } }),
      0,
      null,
    )!;
    expect(near.headDrop).toBeCloseTo(-1, 5);
    expect(far.headDrop).toBeCloseTo(-1, 5);
  });

  test("a nose a fifth of a shoulder-width lower is a fifth of a shoulder-width of drop", () => {
    const upright = postureFrame(body(), 0, null)!;
    const lower = postureFrame(body({ 0: { y: 0.3 + 0.2 * 0.2 } }), 0, null)!;
    expect(lower.headDrop - upright.headDrop).toBeCloseTo(0.2, 5);
    expect(lower.headDrop - upright.headDrop).toBeGreaterThan(POSTURE.slouchDelta);
  });

  test("shoulders the model is unsure about measure nothing at all", () => {
    expect(postureFrame(body({ 11: { visibility: 0.49 } }), 0, null)).toBe(null);
    expect(postureFrame(body({ 12: { visibility: 0 } }), 0, null)).toBe(null);
    expect(postureFrame([], 0, null)).toBe(null);
  });

  test("a visible hand inside the radius flags, one outside it does not", () => {
    const near = body({ 19: { x: 0.5, y: 0.35, visibility: 0.9 } });
    const far = body({ 19: { x: 0.5, y: 0.05, visibility: 0.9 } });
    expect(postureFrame(near, 0, null)!.handNearFace).toBe(true);
    expect(postureFrame(far, 0, null)!.handNearFace).toBe(false);
  });

  test("a hand the model cannot see is never counted as being at the face", () => {
    const hidden = body({ 19: { x: 0.5, y: 0.31, visibility: 0.2 } });
    expect(postureFrame(hidden, 0, null)!.handNearFace).toBe(false);
  });

  test("the first frame has no wrist speed, because there is nothing to compare it against", () => {
    const wristed = body({ 15: { x: 0.7, y: 0.9, visibility: 0.9 } });
    const first = postureFrame(wristed, 0, null)!;
    expect(first.wristSpeed).toBe(null);
    expect(first.wristPos).toEqual([{ x: 0.7, y: 0.9 }]);
  });

  test("wrist speed is shoulder-widths a second, not pixels", () => {
    const wristed = (x: number) => body({ 15: { x, y: 0.9, visibility: 0.9 } });
    const first = postureFrame(wristed(0.7), 0, null)!;
    const second = postureFrame(wristed(0.8), 1000, first)!;
    expect(second.wristSpeed).toBeCloseTo(0.5, 5);
  });

  test("a wrist appearing or disappearing measures no speed rather than a jump", () => {
    const one = postureFrame(body({ 15: { x: 0.7, y: 0.9, visibility: 0.9 } }), 0, null)!;
    const two = postureFrame(
      body({ 15: { x: 0.7, y: 0.9, visibility: 0.9 }, 16: { x: 0.3, y: 0.9, visibility: 0.9 } }),
      333,
      one,
    )!;
    expect(two.wristSpeed).toBe(null);
  });

  test("two frames at the same instant cannot divide by zero", () => {
    const wristed = body({ 15: { x: 0.7, y: 0.9, visibility: 0.9 } });
    const first = postureFrame(wristed, 500, null)!;
    expect(postureFrame(wristed, 500, first)!.wristSpeed).toBe(null);
  });
});

describe("medianHeadDrop", () => {
  test("an odd count takes the middle, an even count the mean of the middle pair", () => {
    expect(medianHeadDrop(frames(1, { headDrop: -0.4 }))).toBe(-0.4);
    expect(
      medianHeadDrop([
        ...frames(1, { headDrop: -0.6 }),
        ...frames(1, { headDrop: -0.2 }),
        ...frames(1, { headDrop: -0.4 }),
      ]),
    ).toBe(-0.4);
    expect(
      medianHeadDrop([...frames(1, { headDrop: -0.6 }), ...frames(1, { headDrop: -0.2 })]),
    ).toBeCloseTo(-0.4, 5);
  });

  test("nothing to sort is a zero baseline, not a NaN", () => {
    expect(medianHeadDrop([])).toBe(0);
  });
});

describe("summarizePosture", () => {
  const CALIBRATED = { headDrop: -1, calibrated: true };

  test("a pose nobody calibrated measures nothing, however many frames there are", () => {
    expect(summarizePosture(frames(60), { headDrop: -1, calibrated: false }, 3)).toBe(null);
  });

  test("too few frames to mean anything measure nothing", () => {
    expect(summarizePosture(frames(POSTURE.minFrames - 1), CALIBRATED, 3)).toBe(null);
    expect(summarizePosture(frames(POSTURE.minFrames), CALIBRATED, 3)).not.toBe(null);
  });

  test("slouch is counted against the calibrated pose, not against an upright average", () => {
    const slouched = frames(6, { headDrop: -1 + POSTURE.slouchDelta + 0.01 });
    expect(summarizePosture(slouched, CALIBRATED, 3)!.slouch_pct).toBe(100);
    expect(summarizePosture(frames(6, { headDrop: -1 }), CALIBRATED, 3)!.slouch_pct).toBe(0);

    const lowBaseline = { headDrop: -1 + POSTURE.slouchDelta + 0.01, calibrated: true };
    expect(summarizePosture(slouched, lowBaseline, 3)!.slouch_pct).toBe(0);
  });

  test("shares are frames over frames, rounded to a tenth", () => {
    const mixed = [...frames(1, { handNearFace: true }), ...frames(5)];
    const summary = summarizePosture(mixed, CALIBRATED, 3)!;
    expect(summary.frames).toBe(6);
    expect(summary.hands_to_face_pct).toBe(16.7);
    expect(summary.sample_hz).toBe(3);
  });

  test("tilt is averaged as a magnitude, so leaning both ways does not cancel out", () => {
    const both = [...frames(3, { tiltDeg: 6 }), ...frames(3, { tiltDeg: -6 })];
    expect(summarizePosture(both, CALIBRATED, 3)!.shoulder_tilt_deg).toBe(6);
  });

  test("only the frames that carried a wrist speed are averaged, and none means zero", () => {
    const some = [...frames(3, { wristSpeed: 0.2 }), ...frames(3)];
    expect(summarizePosture(some, CALIBRATED, 3)!.wrist_motion).toBe(0.2);
    expect(summarizePosture(frames(6), CALIBRATED, 3)!.wrist_motion).toBe(0);
  });
});
