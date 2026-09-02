/// <reference lib="webworker" />
import { KokoroTTS, TextSplitterStream } from "kokoro-js";

export type KokoroIn =
  | { type: "load"; device: "webgpu" | "wasm" }
  | { type: "speak"; id: number; text: string; voice: string; speed: number }
  | { type: "cancel" };

export type KokoroOut =
  | { type: "progress"; progress: number | null; file?: string }
  | { type: "ready"; device: "webgpu" | "wasm" }
  | { type: "chunk"; id: number; seq: number; sampleRate: number; audio: Float32Array<ArrayBuffer> }
  | { type: "done"; id: number }
  | { type: "error"; id?: number; message: string };

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts: KokoroTTS | null = null;
let loading: Promise<KokoroTTS> | null = null;
let current = 0;

function post(msg: KokoroOut, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

function load(device: "webgpu" | "wasm"): Promise<KokoroTTS> {
  loading ??= KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: device === "webgpu" ? "fp32" : "q8",
    device,
    progress_callback: (p: unknown) => {
      const info = p as { status?: string; progress?: number; file?: string };
      if (info.status === "progress" && typeof info.progress === "number") {
        post({ type: "progress", progress: info.progress / 100, file: info.file });
      }
    },
  }).then((model) => {
    tts = model;
    post({ type: "ready", device });
    return model;
  });
  return loading;
}

self.onmessage = async (e: MessageEvent<KokoroIn>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      await load(msg.device);
      return;
    }
    if (msg.type === "cancel") {
      current++;
      return;
    }
    if (msg.type === "speak") {
      const model = tts ?? (await loading);
      if (!model) throw new Error("kokoro: model not loaded");
      current = msg.id;
      const splitter = new TextSplitterStream();
      const stream = model.stream(splitter, { voice: msg.voice as "af_heart", speed: msg.speed });
      splitter.push(msg.text);
      splitter.close();
      let seq = 0;
      for await (const { audio } of stream) {
        if (current !== msg.id) break;
        const data = audio.audio as Float32Array<ArrayBuffer>;
        post(
          { type: "chunk", id: msg.id, seq: seq++, sampleRate: audio.sampling_rate, audio: data },
          [data.buffer],
        );
      }
      if (current === msg.id) post({ type: "done", id: msg.id });
    }
  } catch (err) {
    post({
      type: "error",
      id: msg.type === "speak" ? msg.id : undefined,
      message: (err as Error).message,
    });
  }
};
