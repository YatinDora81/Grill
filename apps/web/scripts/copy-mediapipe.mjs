#!/usr/bin/env node
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "mediapipe", "wasm");

function findWasmDir() {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("@mediapipe/tasks-vision/vision_wasm_internal.js");
  return dirname(entry);
}

async function isStale(from, to) {
  try {
    const [src, dest] = await Promise.all([stat(from), stat(to)]);
    return src.size !== dest.size || src.mtimeMs > dest.mtimeMs;
  } catch {
    return true;
  }
}

async function main() {
  let wasmDir;
  try {
    wasmDir = findWasmDir();
  } catch {
    console.warn(
      "[copy-mediapipe] @mediapipe/tasks-vision is not installed; on-camera metrics will stay off.",
    );
    return;
  }

  const files = (await readdir(wasmDir)).filter((f) => f.endsWith(".js") || f.endsWith(".wasm"));
  if (files.length === 0) {
    console.warn(`[copy-mediapipe] no wasm files under ${wasmDir}; nothing to copy.`);
    return;
  }

  await mkdir(PUBLIC_DIR, { recursive: true });
  let copied = 0;
  for (const file of files) {
    const from = join(wasmDir, file);
    const to = join(PUBLIC_DIR, file);
    if (!(await isStale(from, to))) continue;
    await copyFile(from, to);
    copied++;
  }
  console.log(
    `[copy-mediapipe] ${files.length} wasm file(s) ready in public/mediapipe/wasm (${copied} copied).`,
  );
}

await main().catch((err) => {
  console.warn("[copy-mediapipe] could not stage the WASM runtime:", err?.message ?? err);
});
