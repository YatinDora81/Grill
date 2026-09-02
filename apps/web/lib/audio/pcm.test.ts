import { expect, test } from "bun:test";
import { base64ToFloat32, floatTo16BitPCM, int16ToBase64, resampleLinear } from "./pcm";

const STEP = 1 / 32768;

test("a frame survives float → int16 → base64 → float to within one quantisation step", () => {
  const frame = new Float32Array([0, 0.5, -0.5, 0.999, -0.999, 0.0001, -0.0001, 1, -1]);

  const back = base64ToFloat32(int16ToBase64(floatTo16BitPCM(frame)));

  expect(back.length).toBe(frame.length);
  for (let i = 0; i < frame.length; i++) {
    expect(Math.abs(back[i]! - frame[i]!)).toBeLessThanOrEqual(STEP);
  }
});

test("anything outside [-1, 1] is clamped rather than wrapped", () => {
  const pcm = floatTo16BitPCM(new Float32Array([4, -4, 1.0001, -1.0001]));

  expect(Array.from(pcm)).toEqual([32767, -32768, 32767, -32768]);
});

test("samples are written little-endian, two bytes each", () => {
  const b64 = int16ToBase64(new Int16Array([1, -2]));

  expect(Array.from(atob(b64), (c) => c.charCodeAt(0))).toEqual([1, 0, 0xfe, 0xff]);
});

test("an empty frame encodes to an empty string and decodes back to nothing", () => {
  expect(int16ToBase64(new Int16Array(0))).toBe("");
  expect(base64ToFloat32("").length).toBe(0);
});

test("48 kHz down to 16 kHz keeps a third of the samples", () => {
  expect(resampleLinear(new Float32Array(4_800), 48_000, 16_000).length).toBe(1_600);
  expect(resampleLinear(new Float32Array(960), 48_000, 16_000).length).toBe(320);
  expect(resampleLinear(new Float32Array(1_600), 16_000, 48_000).length).toBe(4_800);
});

test("resampling at the same rate hands the frame straight back", () => {
  const frame = new Float32Array([0.1, 0.2]);

  expect(resampleLinear(frame, 16_000, 16_000)).toBe(frame);
});

test("a ramp stays a ramp, and never reads past the last sample", () => {
  const ramp = new Float32Array([0, 0.25, 0.5, 0.75]);

  const half = resampleLinear(ramp, 32_000, 16_000);

  expect(half.length).toBe(2);
  expect(half[0]).toBeCloseTo(0, 6);
  expect(half[1]).toBeCloseTo(0.5, 6);
  expect(Number.isNaN(half[1]!)).toBe(false);
});
