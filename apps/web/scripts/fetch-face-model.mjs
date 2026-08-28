#!/usr/bin/env node
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const MODELS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models");
const MODEL_PATH = join(MODELS_DIR, "face_landmarker.task");

const MIN_BYTES = 3_000_000;

const TIMEOUT_MS = 120_000;

async function isStaged() {
  try {
    const { size } = await stat(MODEL_PATH);
    if (size >= MIN_BYTES) return true;
    console.warn(
      `[fetch-face-model] public/models/face_landmarker.task is only ${size} bytes; refetching.`,
    );
    return false;
  } catch {
    return false;
  }
}

async function download() {
  try {
    const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(
        `[fetch-face-model] the model host answered ${res.status} ${res.statusText}; on-camera metrics will stay off.`,
      );
      return null;
    }

    const declared = Number(res.headers.get("content-length"));
    if (declared > 0 && declared < MIN_BYTES) {
      console.warn(
        `[fetch-face-model] the host offered ${declared} bytes, far short of the ~3.6 MB model; refusing it.`,
      );
      return null;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < MIN_BYTES) {
      console.warn(
        `[fetch-face-model] downloaded only ${bytes.byteLength} bytes; that is not the model, discarding it.`,
      );
      return null;
    }
    if (declared > 0 && bytes.byteLength !== declared) {
      console.warn(
        `[fetch-face-model] body ended at ${bytes.byteLength} of ${declared} bytes; discarding the truncated download.`,
      );
      return null;
    }
    return bytes;
  } catch (err) {
    console.warn(
      `[fetch-face-model] could not download the face landmarker model: ${err?.message ?? err}`,
    );
    return null;
  }
}

async function main() {
  if (await isStaged()) {
    console.log("[fetch-face-model] face_landmarker.task already in public/models; skipping.");
    return;
  }

  const bytes = await download();
  if (!bytes) return;

  await mkdir(MODELS_DIR, { recursive: true });

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const partial = `${MODEL_PATH}.${stamp}.part`;
  try {
    await writeFile(partial, bytes);
    await rename(partial, MODEL_PATH);
  } finally {
    await rm(partial, { force: true });
  }

  const mb = (bytes.byteLength / 1_000_000).toFixed(1);
  console.log(`[fetch-face-model] face_landmarker.task (${mb} MB) ready in public/models.`);
}

await main().catch((err) => {
  console.warn("[fetch-face-model] could not stage the model:", err?.message ?? err);
});
