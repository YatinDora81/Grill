import { test, expect } from "bun:test";
import { pcm16ToWav, readPcmRate } from "./wav";

const ascii = (bytes: Uint8Array, from: number, length: number) =>
  String.fromCharCode(...bytes.slice(from, from + length));

const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

test("writes the chunk names a wav decoder looks for", () => {
  const wav = pcm16ToWav(pcm, 24_000);

  expect(ascii(wav, 0, 4)).toBe("RIFF");
  expect(ascii(wav, 8, 4)).toBe("WAVE");
  expect(ascii(wav, 12, 4)).toBe("fmt ");
  expect(ascii(wav, 36, 4)).toBe("data");
});

test("describes the audio Gemini actually returns: 24 kHz, 16-bit, mono", () => {
  const wav = pcm16ToWav(pcm, 24_000);
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  expect(v.getUint32(16, true)).toBe(16);
  expect(v.getUint16(20, true)).toBe(1);
  expect(v.getUint16(22, true)).toBe(1);
  expect(v.getUint32(24, true)).toBe(24_000);
  expect(v.getUint32(28, true)).toBe(48_000);
  expect(v.getUint16(32, true)).toBe(2);
  expect(v.getUint16(34, true)).toBe(16);
});

test("sizes both headers against the payload it was handed", () => {
  const wav = pcm16ToWav(pcm, 24_000);
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  expect(wav).toHaveLength(44 + pcm.byteLength);
  expect(v.getUint32(4, true)).toBe(36 + pcm.byteLength);
  expect(v.getUint32(40, true)).toBe(pcm.byteLength);
});

test("appends the samples untouched, right after the header", () => {
  const wav = pcm16ToWav(pcm, 24_000);

  expect(Array.from(wav.slice(44))).toEqual(Array.from(pcm));
});

test("counts stereo frames at twice the width", () => {
  const wav = pcm16ToWav(pcm, 24_000, 2);
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  expect(v.getUint16(22, true)).toBe(2);
  expect(v.getUint32(28, true)).toBe(96_000);
  expect(v.getUint16(32, true)).toBe(4);
});

test("reads the rate out of the mime type Gemini sends", () => {
  expect(readPcmRate("audio/L16;codec=pcm;rate=24000")).toBe(24_000);
  expect(readPcmRate("audio/L16;codec=pcm;rate=16000")).toBe(16_000);
});

test("falls back to 24 kHz when there is no rate to read", () => {
  expect(readPcmRate(undefined)).toBe(24_000);
  expect(readPcmRate("audio/L16;codec=pcm")).toBe(24_000);
  expect(readPcmRate(undefined, 16_000)).toBe(16_000);
});
