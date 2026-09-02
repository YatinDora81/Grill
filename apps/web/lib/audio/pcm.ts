const BASE64_CHUNK = 8_192;

export function floatTo16BitPCM(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]!));
    out[i] = Math.max(-0x8000, Math.min(0x7fff, Math.round(v * 0x8000)));
  }
  return out;
}

export function int16ToBase64(i: Int16Array): string {
  const bytes = new Uint8Array(i.length * 2);
  const view = new DataView(bytes.buffer);
  for (let n = 0; n < i.length; n++) view.setInt16(n * 2, i[n]!, true);

  let binary = "";
  for (let o = 0; o < bytes.length; o += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(o, o + BASE64_CHUNK));
  }
  return btoa(binary);
}

export function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const samples = binary.length >> 1;
  const out = new Float32Array(samples);
  for (let n = 0; n < samples; n++) {
    const lo = binary.charCodeAt(n * 2);
    const hi = binary.charCodeAt(n * 2 + 1);
    const raw = (hi << 8) | lo;
    out[n] = (raw >= 0x8000 ? raw - 0x10000 : raw) / 0x8000;
  }
  return out;
}

export function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || from <= 0 || to <= 0 || input.length === 0) return input;
  const length = Math.max(1, Math.round((input.length * to) / from));
  const out = new Float32Array(length);
  const step = input.length / length;
  const last = input.length - 1;
  for (let n = 0; n < length; n++) {
    const pos = Math.min(n * step, last);
    const left = Math.floor(pos);
    const right = Math.min(left + 1, last);
    const frac = pos - left;
    out[n] = input[left]! * (1 - frac) + input[right]! * frac;
  }
  return out;
}
