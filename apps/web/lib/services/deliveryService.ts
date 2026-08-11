import "server-only";
/**
 * Delivery metrics (Grill §scoring). pace/pauses/filler = TS math from Whisper
 * timestamps; pitch/energy = Python audio-service (Parselmouth). Tonality is
 * NEVER inferred from text — only from these measured signals.
 */
import type { AcousticMetrics, DeliveryMetrics, TranscriptWord } from "@repo/types";
import { config } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/clients/http";
import { FILLER_WORDS, LIKE_LITERAL_AFTER, LIKE_LITERAL_BEFORE } from "@/lib/fillers";

export function countFillers(transcript: string): number {
  const text = ` ${transcript.toLowerCase()} `;
  let count = 0;
  for (const filler of FILLER_WORDS) {
    const re = new RegExp(`(?<![\\w])${escapeRe(filler)}(?![\\w])`, "g");
    const matches = text.match(re);
    if (matches) count += matches.length;
  }
  count += countLike(text);
  return count;
}

function countLike(lowerText: string): number {
  const re = /(?<![\w])like(?![\w])/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lowerText)) !== null) {
    const before = lowerText.slice(0, m.index).trimEnd();
    const after = lowerText.slice(m.index + "like".length);
    if (LIKE_LITERAL_BEFORE.test(before) || LIKE_LITERAL_AFTER.test(after)) continue;
    count++;
  }
  return count;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function textDeliveryMetrics(
  turns: { transcript: string | null; transcriptWords: TranscriptWord[] | null }[],
): { wpm: number; avg_pause_ms: number; filler_count: number } {
  let totalWords = 0;
  let speakingSeconds = 0;
  const gaps: number[] = [];
  let fillerCount = 0;

  for (const t of turns) {
    if (t.transcript) fillerCount += countFillers(t.transcript);
    const words = t.transcriptWords ?? [];
    if (words.length === 0) continue;
    totalWords += words.length;
    const first = words[0]!;
    const last = words[words.length - 1]!;
    speakingSeconds += Math.max(0, last.end - first.start);
    for (let i = 1; i < words.length; i++) {
      const gap = words[i]!.start - words[i - 1]!.end;
      if (gap > 0) gaps.push(gap);
    }
  }

  const wpm = speakingSeconds > 0 ? (totalWords / speakingSeconds) * 60 : 0;
  const avgPauseMs = gaps.length > 0 ? (gaps.reduce((a, b) => a + b, 0) / gaps.length) * 1000 : 0;

  return { wpm: round(wpm), avg_pause_ms: round(avgPauseMs), filler_count: fillerCount };
}

/** POST one clip to the Python service. Returns null if it's unavailable. */
export async function analyzeAcoustics(
  audio: Uint8Array,
  filename: string,
  mime: string,
): Promise<AcousticMetrics | null> {
  try {
    const form = new FormData();
    form.append("file", new Blob([audio as unknown as BlobPart], { type: mime }), filename);
    const res = await fetchWithTimeout(
      `${config.audio.serviceUrl}/analyze`,
      { method: "POST", body: form },
      config.rotation.providerTimeoutMs,
    );
    if (!res.ok) {
      console.warn(`[deliveryService] audio service ${res.status}; skipping acoustics`);
      return null;
    }
    return (await res.json()) as AcousticMetrics;
  } catch (err) {
    console.warn(`[deliveryService] audio service unreachable: ${(err as Error).message}`);
    return null;
  }
}

export function aggregateAcoustics(
  results: (AcousticMetrics | null)[],
): { pitch_variation: number | null; energy: number | null; mean_pitch_hz: number | null } {
  const present = results.filter((r): r is AcousticMetrics => r !== null);
  if (present.length === 0) return { pitch_variation: null, energy: null, mean_pitch_hz: null };
  const mean = (sel: (m: AcousticMetrics) => number) =>
    round(present.reduce((a, m) => a + sel(m), 0) / present.length);
  return {
    pitch_variation: mean((m) => m.pitch_variation),
    energy: mean((m) => m.energy),
    mean_pitch_hz: mean((m) => m.mean_pitch_hz),
  };
}

export function combineDelivery(
  text: { wpm: number; avg_pause_ms: number; filler_count: number },
  acoustics: { pitch_variation: number | null; energy: number | null; mean_pitch_hz: number | null },
): DeliveryMetrics {
  return { ...text, ...acoustics };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
