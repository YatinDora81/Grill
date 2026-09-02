#!/usr/bin/env node
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "vad");
const require = createRequire(import.meta.url);

function distDir(pkg, probe) {
  return dirname(require.resolve(`${pkg}/${probe}`));
}

async function isStale(from, to) {
  try {
    const [src, dest] = await Promise.all([stat(from), stat(to)]);
    return src.size !== dest.size || src.mtimeMs > dest.mtimeMs;
  } catch {
    return true;
  }
}

async function copyMatching(dir, test) {
  let copied = 0;
  for (const file of (await readdir(dir)).filter(test)) {
    const from = join(dir, file);
    const to = join(PUBLIC_DIR, file);
    if (!(await isStale(from, to))) continue;
    await copyFile(from, to);
    copied++;
  }
  return copied;
}

async function main() {
  let vadDir;
  let ortDir;
  try {
    vadDir = distDir("@ricky0123/vad-web", "dist/index.js");
    ortDir = distDir("onnxruntime-web", "ort-wasm-simd-threaded.mjs");
  } catch {
    console.warn("[copy-vad] vad-web or onnxruntime-web is not installed; hands-free stays off.");
    return;
  }
  await mkdir(PUBLIC_DIR, { recursive: true });
  const a = await copyMatching(vadDir, (f) =>
    /^(vad\.worklet\.bundle\.min\.js|silero_vad_(v5|legacy)\.onnx)$/.test(f),
  );
  const b = await copyMatching(ortDir, (f) => /^ort-wasm.*\.(wasm|mjs)$/.test(f));
  console.log(`[copy-vad] VAD assets ready in public/vad (${a + b} copied).`);
}

await main().catch((err) => {
  console.warn("[copy-vad] could not stage VAD assets:", err?.message ?? err);
});
