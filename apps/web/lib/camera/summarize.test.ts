import { describe, expect, test } from "bun:test";
import type { CameraFrame } from "./types";
import {
  AWAY_BLOCK_MIN_PCT,
  AWAY_SEGMENT_KEYS,
  CAMERA_METRIC_KEYS,
  CAMERA_THRESHOLDS,
  awayBlocks,
  classifyFrame,
  eulerFromMatrix,
  formatAwayDuration,
  landmarkPoseProxy,
  medianPose,
  mergeAwaySegments,
  summarizeTurn,
  formatTakeOffset,
  takeMs,
} from "./summarize";

const SAMPLE_HZ = 5;
const STEP_MS = 1000 / SAMPLE_HZ;

function onCamera(t: number, over: Partial<CameraFrame> = {}): CameraFrame {
  return {
    t,
    face: true,
    yaw: 0,
    pitch: 0,
    gazeH: 0.05,
    gazeV: 0.05,
    smile: 0,
    blink: 0,
    ...over,
  };
}

const AWAY: Partial<CameraFrame> = { yaw: 32, gazeH: 0.7 };

const BLINK: Partial<CameraFrame> = { blink: 0.9, gazeH: 0.9, gazeV: 0.9 };

function stream(seconds: number, over: (t: number) => Partial<CameraFrame> = () => ({})): CameraFrame[] {
  const frames: CameraFrame[] = [];
  for (let t = 0; t < seconds * 1000; t += STEP_MS) frames.push(onCamera(t, over(t)));
  return frames;
}

describe("classifyFrame", () => {
  test("a missing face is not evidence of anything, in either direction", () => {
    const v = classifyFrame(onCamera(0, { face: false, smile: 1 }));
    expect(v).toEqual({ onCamera: false, smiling: false, usable: false });
  });

  test("a blink is unusable for gaze but still counts for the mouth", () => {
    const v = classifyFrame(onCamera(0, { ...BLINK, smile: 0.8 }));
    expect(v.usable).toBe(false);
    expect(v.smiling).toBe(true);
  });

  test("gaze and head pose each veto on their own", () => {
    expect(classifyFrame(onCamera(0, { gazeH: 0.9 })).onCamera).toBe(false);
    expect(classifyFrame(onCamera(0, { gazeV: 0.9 })).onCamera).toBe(false);
    expect(classifyFrame(onCamera(0, { yaw: 40 })).onCamera).toBe(false);
    expect(classifyFrame(onCamera(0, { pitch: -40 })).onCamera).toBe(false);
  });

  test("only the magnitude of the angle matters, so a mirrored camera is harmless", () => {
    const left = classifyFrame(onCamera(0, { yaw: -32 }));
    const right = classifyFrame(onCamera(0, { yaw: 32 }));
    expect(left).toEqual(right);
  });

  test("the thresholds are the boundary, and they are exclusive", () => {
    expect(classifyFrame(onCamera(0, { yaw: CAMERA_THRESHOLDS.yawDeg })).onCamera).toBe(false);
    expect(classifyFrame(onCamera(0, { yaw: CAMERA_THRESHOLDS.yawDeg - 0.1 })).onCamera).toBe(true);
  });
});

describe("mergeAwaySegments", () => {
  test("a gap of 300 ms or less is one run with a flicker in it", () => {
    const merged = mergeAwaySegments([
      { start_ms: 0, end_ms: 400 },
      { start_ms: 700, end_ms: 1200 },
    ]);
    expect(merged).toEqual([{ start_ms: 0, end_ms: 1200 }]);
  });

  test("a gap over 300 ms keeps them apart, and each must earn its own place", () => {
    const merged = mergeAwaySegments([
      { start_ms: 0, end_ms: 800 },
      { start_ms: 1200, end_ms: 2400 },
    ]);
    expect(merged).toEqual([
      { start_ms: 0, end_ms: 800 },
      { start_ms: 1200, end_ms: 2400 },
    ]);
  });

  test("merging happens before filtering, so a flickering long run survives whole", () => {
    const pieces = [0, 700, 1400, 2100].map((s) => ({ start_ms: s, end_ms: s + 400 }));
    expect(mergeAwaySegments(pieces)).toEqual([{ start_ms: 0, end_ms: 2500 }]);
  });

  test("a glance shorter than the floor is dropped", () => {
    expect(mergeAwaySegments([{ start_ms: 1000, end_ms: 1300 }])).toEqual([]);
  });

  test("input order does not matter and the input is never mutated", () => {
    const raw = [
      { start_ms: 2000, end_ms: 3000 },
      { start_ms: 0, end_ms: 900 },
    ];
    const snapshot = JSON.parse(JSON.stringify(raw)) as typeof raw;
    expect(mergeAwaySegments(raw)).toEqual([
      { start_ms: 0, end_ms: 900 },
      { start_ms: 2000, end_ms: 3000 },
    ]);
    expect(raw).toEqual(snapshot);
  });
});

describe("summarizeTurn", () => {
  test("ten seconds looking at the lens is 100% and no away runs", () => {
    const m = summarizeTurn(stream(10), SAMPLE_HZ, "matrix");
    expect(m).not.toBeNull();
    expect(m!.frames).toBe(50);
    expect(m!.no_face_frames).toBe(0);
    expect(m!.on_camera_pct).toBe(100);
    expect(m!.away_segments).toEqual([]);
    expect(m!.longest_away_ms).toBe(0);
    expect(m!.head_motion_dps).toBe(0);
    expect(m!.sample_hz).toBe(SAMPLE_HZ);
    expect(m!.pose_source).toBe("matrix");
  });

  test("three seconds off in the middle is one segment on the take's own clock", () => {
    const m = summarizeTurn(
      stream(10, (t) => (t >= 3000 && t < 6000 ? AWAY : {})),
      SAMPLE_HZ,
      "matrix",
    );
    expect(m!.away_segments).toEqual([{ start_ms: 3000, end_ms: 6000 }]);
    expect(m!.longest_away_ms).toBe(3000);
    expect(m!.on_camera_pct).toBe(70);
  });

  test("a 300 ms glance is not looking away", () => {
    const m = summarizeTurn(
      stream(10, (t) => (t === 4000 ? AWAY : {})),
      SAMPLE_HZ,
      "matrix",
    );
    expect(m!.away_segments).toEqual([]);
    expect(m!.longest_away_ms).toBe(0);
    expect(m!.on_camera_pct).toBe(98);
  });

  test("blinking neither opens an away run nor closes one", () => {
    const blinking = summarizeTurn(
      stream(10, (t) => (t >= 4000 && t < 5000 ? BLINK : {})),
      SAMPLE_HZ,
      "matrix",
    );
    expect(blinking!.away_segments).toEqual([]);
    expect(blinking!.on_camera_pct).toBe(100);

    const interrupted = summarizeTurn(
      stream(10, (t) => {
        if (t === 4000) return BLINK;
        return t >= 3000 && t < 6000 ? AWAY : {};
      }),
      SAMPLE_HZ,
      "matrix",
    );
    expect(interrupted!.away_segments).toEqual([{ start_ms: 3000, end_ms: 6000 }]);
  });

  test("a face that vanishes counts as away, and as a no-face frame", () => {
    const m = summarizeTurn(
      stream(10, (t) => (t >= 2000 && t < 5000 ? { face: false } : {})),
      SAMPLE_HZ,
      "matrix",
    );
    expect(m!.no_face_frames).toBe(15);
    expect(m!.frames).toBe(35);
    expect(m!.away_segments).toEqual([{ start_ms: 2000, end_ms: 5000 }]);
  });

  test("a run still open at the end closes at the last sample", () => {
    const m = summarizeTurn(
      stream(10, (t) => (t >= 7000 ? AWAY : {})),
      SAMPLE_HZ,
      "matrix",
    );
    expect(m!.away_segments).toEqual([{ start_ms: 7000, end_ms: 9800 }]);
  });

  test("under two seconds of face says nothing at all", () => {
    expect(summarizeTurn(stream(1.8), SAMPLE_HZ, "matrix")).toBeNull();
    const padded = [...stream(1.8), ...stream(4).map((f) => ({ ...f, face: false }))];
    expect(summarizeTurn(padded, SAMPLE_HZ, "matrix")).toBeNull();
  });

  test("a whole answer of blinks is not measured, never 0%", () => {
    const m = summarizeTurn(stream(10, () => BLINK), SAMPLE_HZ, "matrix");
    expect(m).toBeNull();
  });

  test("smiles are counted over face frames, blinks included", () => {
    const m = summarizeTurn(
      stream(10, (t) => (t < 2000 ? { smile: 0.8 } : {})),
      SAMPLE_HZ,
      "matrix",
    );
    expect(m!.smile_pct).toBe(20);
  });

  test("head motion is degrees per second, not degrees per sample", () => {
    const m = summarizeTurn(
      stream(10, (t) => ({ yaw: (t / STEP_MS) * 3 })),
      SAMPLE_HZ,
      "matrix",
    );
    expect(m!.head_motion_dps).toBe(15);
  });

  test("the pose source is carried through so the angles can be weighed later", () => {
    expect(summarizeTurn(stream(10), SAMPLE_HZ, "landmarks")!.pose_source).toBe("landmarks");
  });

  test("the result carries only aggregates — no landmarks, no frames, no pixels", () => {
    const m = summarizeTurn(
      stream(10, (t) => (t >= 3000 && t < 6000 ? AWAY : {})),
      SAMPLE_HZ,
      "matrix",
    );
    expect(Object.keys(m!).sort()).toEqual([...CAMERA_METRIC_KEYS].sort());
    for (const seg of m!.away_segments) {
      expect(Object.keys(seg).sort()).toEqual([...AWAY_SEGMENT_KEYS].sort());
    }

    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") return Object.values(v).forEach(walk);
      if (typeof v === "string") {
        expect(["matrix", "landmarks"]).toContain(v);
        return;
      }
      expect(typeof v).toBe("number");
    };
    walk(JSON.parse(JSON.stringify(m)));
  });
});

describe("eulerFromMatrix", () => {
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  test("the identity matrix is a head pointed straight ahead", () => {
    expect(eulerFromMatrix(IDENTITY)).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });

  test("a 30° yaw about the Y axis reads back as 30°", () => {
    const a = Math.PI / 6;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const m = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
    expect(eulerFromMatrix(m).yaw).toBeCloseTo(30, 6);
    expect(eulerFromMatrix(m).pitch).toBeCloseTo(0, 6);
  });

  test("a short or empty matrix degrades to zero rather than to NaN", () => {
    const angles = eulerFromMatrix([]);
    expect(Number.isFinite(angles.yaw)).toBe(true);
    expect(angles).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });
});

describe("landmarkPoseProxy", () => {
  const centred = () => {
    const lm = Array.from({ length: 468 }, () => ({ x: 0, y: 0 }));
    lm[1] = { x: 0.5, y: 0.5 };
    lm[33] = { x: 0.4, y: 0.5 };
    lm[263] = { x: 0.6, y: 0.5 };
    return lm;
  };

  test("a centred nose is a neutral pose", () => {
    expect(landmarkPoseProxy(centred())).toEqual({ yaw: 0, pitch: 0 });
  });

  test("the proxy is monotonic in both axes", () => {
    const lm = centred();
    lm[1] = { x: 0.55, y: 0.5 };
    const turned = landmarkPoseProxy(lm);
    lm[1] = { x: 0.6, y: 0.5 };
    const turnedMore = landmarkPoseProxy(lm);
    expect(turned.yaw).toBeGreaterThan(0);
    expect(turnedMore.yaw).toBeGreaterThan(turned.yaw);

    lm[1] = { x: 0.5, y: 0.56 };
    expect(landmarkPoseProxy(lm).pitch).toBeGreaterThan(0);
  });

  test("landmarks the model never produced degrade to neutral, not to NaN", () => {
    expect(landmarkPoseProxy([])).toEqual({ yaw: 0, pitch: 0 });
  });
});

describe("medianPose", () => {
  test("one glance during calibration cannot drag the baseline", () => {
    const samples = [
      { yaw: 1, pitch: -9 },
      { yaw: 2, pitch: -8 },
      { yaw: 1, pitch: -9 },
      { yaw: 2, pitch: -10 },
      { yaw: 40, pitch: 25 },
    ];
    const baseline = medianPose(samples);
    expect(baseline).toEqual({ yaw: 2, pitch: -9 });
  });

  test("an even number of samples averages the two middles", () => {
    expect(medianPose([{ yaw: 0, pitch: 0 }, { yaw: 4, pitch: 2 }])).toEqual({ yaw: 2, pitch: 1 });
  });

  test("no samples is a zero baseline, which is the uncalibrated behaviour", () => {
    expect(medianPose([])).toEqual({ yaw: 0, pitch: 0 });
  });
});

describe("awayBlocks", () => {
  test("a segment is placed as a percentage of the take", () => {
    const [block] = awayBlocks([{ start_ms: 15_000, end_ms: 30_000 }], 60_000);
    expect(block).toEqual({ start_ms: 15_000, end_ms: 30_000, leftPct: 25, widthPct: 25 });
  });

  test("a run too short to see is widened to a clickable minimum", () => {
    const [block] = awayBlocks([{ start_ms: 0, end_ms: 700 }], 240_000);
    expect(block!.widthPct).toBe(AWAY_BLOCK_MIN_PCT);
  });

  test("a block never hangs off the right edge", () => {
    const [block] = awayBlocks([{ start_ms: 59_900, end_ms: 60_000 }], 60_000);
    expect(block!.leftPct + block!.widthPct).toBeLessThanOrEqual(100.05);
  });

  test("a segment past the end of the take is clamped, not drawn outside it", () => {
    const [block] = awayBlocks([{ start_ms: 50_000, end_ms: 90_000 }], 60_000);
    expect(block!.leftPct).toBeCloseTo(83.3, 1);
    expect(block!.leftPct + block!.widthPct).toBeLessThanOrEqual(100.05);
    expect(block!.end_ms).toBe(90_000);
  });

  test("a take with no measurable length draws nothing", () => {
    expect(awayBlocks([{ start_ms: 0, end_ms: 1000 }], 0)).toEqual([]);
    expect(awayBlocks([{ start_ms: 0, end_ms: 1000 }], Number.NaN)).toEqual([]);
  });

  test("a zero-length segment is not a block", () => {
    expect(awayBlocks([{ start_ms: 1000, end_ms: 1000 }], 60_000)).toEqual([]);
  });
});

describe("takeMs", () => {
  test("the last spoken word sets the length", () => {
    expect(takeMs(42.5, [])).toBe(42_500);
  });

  test("walking off after the last word extends the bar rather than clipping the run", () => {
    expect(takeMs(20, [{ start_ms: 18_000, end_ms: 26_000 }])).toBe(26_000);
  });

  test("a typed answer with no timings falls back to the segments alone", () => {
    expect(takeMs(null, [{ start_ms: 0, end_ms: 4_000 }])).toBe(4_000);
    expect(takeMs(null, [])).toBe(0);
  });
});

describe("formatAwayDuration", () => {
  test("one decimal, matching the 5 Hz sampling", () => {
    expect(formatAwayDuration(4200)).toBe("4.2 s");
    expect(formatAwayDuration(600)).toBe("0.6 s");
  });

  test("a nonsense negative reads as zero rather than as a minus sign", () => {
    expect(formatAwayDuration(-100)).toBe("0.0 s");
  });
});

describe("formatTakeOffset", () => {
  test("m:ss, with the seconds always two digits", () => {
    expect(formatTakeOffset(0)).toBe("0:00");
    expect(formatTakeOffset(18_400)).toBe("0:18");
    expect(formatTakeOffset(65_000)).toBe("1:05");
    expect(formatTakeOffset(600_000)).toBe("10:00");
  });

  test("a negative offset is the start of the take, not a minute in the past", () => {
    expect(formatTakeOffset(-5000)).toBe("0:00");
  });
});
