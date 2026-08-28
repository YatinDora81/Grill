import "server-only";
import type { TranscriptWord } from "@repo/types";
import { config } from "@/lib/env";
import { serviceUnavailable } from "@/lib/errors";
import { fetchWithTimeout, ensureOk } from "./http";
import { callWithRotation, groqPool } from "./keyPool";

const GROQ_TRANSCRIBE = "https://api.groq.com/openai/v1/audio/transcriptions";

export interface Transcription {
  text: string;
  words: TranscriptWord[];
}

export async function transcribe(
  audio: Uint8Array,
  filename: string,
  mime: string,
): Promise<Transcription> {
  if (groqPool.isEmpty) {
    throw serviceUnavailable("Transcription is unavailable: no Groq keys configured.", "stt_unavailable");
  }

  return callWithRotation(groqPool, async (key) => {
    const form = new FormData();
    form.append("file", new Blob([audio as unknown as BlobPart], { type: mime }), filename);
    form.append("model", config.groq.whisperModel);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");

    const res = await ensureOk(
      await fetchWithTimeout(GROQ_TRANSCRIBE, {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: form,
      }),
      "groq-whisper",
    );
    const data = (await res.json()) as {
      text?: string;
      words?: { word: string; start: number; end: number }[];
    };
    return {
      text: (data.text ?? "").trim(),
      words: (data.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
    };
  });
}
