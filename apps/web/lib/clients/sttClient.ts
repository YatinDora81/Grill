import "server-only";
import type { TranscriptSegment, TranscriptWord } from "@repo/types";
import { config } from "@/lib/env";
import { serviceUnavailable } from "@/lib/errors";
import { fetchWithTimeout, ensureOk } from "./http";
import { callWithRotation, groqPool } from "./keyPool";

const GROQ_TRANSCRIBE = "https://api.groq.com/openai/v1/audio/transcriptions";

export interface Transcription {
  text: string;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
  confidence: number | null;
}

export function transcriberConfidence(segments: TranscriptSegment[]): number | null {
  let weight = 0;
  let sum = 0;
  for (const s of segments) {
    if (s.avg_logprob === null || !Number.isFinite(s.avg_logprob)) continue;
    const w = Math.max(0.01, s.end - s.start);
    weight += w;
    sum += s.avg_logprob * w;
  }
  return weight > 0 ? Math.round((sum / weight) * 1000) / 1000 : null;
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
    form.append("timestamp_granularities[]", "segment");

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
      segments?: {
        start: number;
        end: number;
        avg_logprob?: number;
        no_speech_prob?: number;
        compression_ratio?: number;
      }[];
    };
    const segments: TranscriptSegment[] = (data.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      avg_logprob: finite(s.avg_logprob),
      no_speech_prob: finite(s.no_speech_prob),
      compression_ratio: finite(s.compression_ratio),
    }));
    return {
      text: (data.text ?? "").trim(),
      words: (data.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
      segments,
      confidence: transcriberConfidence(segments),
    };
  });
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
