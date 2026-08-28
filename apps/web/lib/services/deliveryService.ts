import "server-only";
import type { AcousticMetrics, DeliveryMetrics, TranscriptWord } from "@repo/types";
import { cameraMetricsSchema } from "@/lib/schemas";
import { config } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/clients/http";
import { FILLER_WORDS, LIKE_LITERAL_AFTER, LIKE_LITERAL_BEFORE } from "@/lib/fillers";
import { sentenceSpans } from "./starService";

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

const QUESTION_ENDING = /\?["')\]]*$/;
const MIN_STATEMENT_WORDS = 4;

export function statementEnds(words: TranscriptWord[] | null): number[] {
  if (!words || words.length === 0) return [];
  return sentenceSpans(words)
    .filter((span) => {
      const text = span.text.trim();
      if (QUESTION_ENDING.test(text)) return false;
      return text.split(/\s+/).filter(Boolean).length >= MIN_STATEMENT_WORDS;
    })
    .map((span) => span.end);
}

export async function analyzeAcoustics(
  audio: Uint8Array,
  filename: string,
  mime: string,
  sentenceEnds?: number[] | null,
): Promise<AcousticMetrics | null> {
  try {
    const form = new FormData();
    form.append("file", new Blob([audio as unknown as BlobPart], { type: mime }), filename);
    if (sentenceEnds && sentenceEnds.length > 0) {
      form.append("sentence_ends", JSON.stringify(sentenceEnds));
    }
    const res = await fetchWithTimeout(
      `${config.audio.serviceUrl}/analyze`,
      { method: "POST", body: form },
      config.rotation.providerTimeoutMs,
    );
    if (!res.ok) {
      console.warn(`[deliveryService] audio service ${res.status}; skipping acoustics`);
      return null;
    }
    return readAcoustics(await res.json());
  } catch (err) {
    console.warn(`[deliveryService] audio service unreachable: ${(err as Error).message}`);
    return null;
  }
}

function readAcoustics(value: unknown): AcousticMetrics | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const pitch_variation = num(m.pitch_variation);
  const energy = num(m.energy);
  const mean_pitch_hz = num(m.mean_pitch_hz);
  if (pitch_variation === null || energy === null || mean_pitch_hz === null) {
    console.warn("[deliveryService] audio service returned no usable acoustics for a clip");
    return null;
  }

  return {
    pitch_variation,
    energy,
    mean_pitch_hz,
    jitter_local: num(m.jitter_local),
    shimmer_local: num(m.shimmer_local),
    hnr_db: num(m.hnr_db),
    uptalk_statements: num(m.uptalk_statements),
    uptalk_rising: num(m.uptalk_rising),
  };
}

export interface AggregatedAcoustics {
  pitch_variation: number | null;
  energy: number | null;
  mean_pitch_hz: number | null;
  jitter_local: number | null;
  shimmer_local: number | null;
  hnr_db: number | null;
  uptalk_pct: number | null;
  uptalk_statements: number;
  uptalk_rising: number;
}

const NO_ACOUSTICS: AggregatedAcoustics = {
  pitch_variation: null,
  energy: null,
  mean_pitch_hz: null,
  jitter_local: null,
  shimmer_local: null,
  hnr_db: null,
  uptalk_pct: null,
  uptalk_statements: 0,
  uptalk_rising: 0,
};

export function aggregateAcoustics(results: (AcousticMetrics | null)[]): AggregatedAcoustics {
  const present = results.filter((r): r is AcousticMetrics => r !== null);
  if (present.length === 0) return NO_ACOUSTICS;

  const mean = (sel: (m: AcousticMetrics) => number) =>
    round(present.reduce((a, m) => a + sel(m), 0) / present.length);

  const meanOf = (sel: (m: AcousticMetrics) => number | null, digits: number): number | null => {
    const values = present.flatMap((m) => {
      const v = sel(m);
      return v === null ? [] : [v];
    });
    if (values.length === 0) return null;
    return roundTo(values.reduce((a, b) => a + b, 0) / values.length, digits);
  };

  const statements = present.reduce((a, m) => a + (m.uptalk_statements ?? 0), 0);
  const rising = present.reduce((a, m) => a + (m.uptalk_rising ?? 0), 0);

  return {
    pitch_variation: mean((m) => m.pitch_variation),
    energy: mean((m) => m.energy),
    mean_pitch_hz: mean((m) => m.mean_pitch_hz),
    jitter_local: meanOf((m) => m.jitter_local, 5),
    shimmer_local: meanOf((m) => m.shimmer_local, 5),
    hnr_db: meanOf((m) => m.hnr_db, 2),
    uptalk_pct: statements > 0 ? roundTo((rising / statements) * 100, 2) : null,
    uptalk_statements: statements,
    uptalk_rising: rising,
  };
}

export interface AggregatedCamera {
  on_camera_pct: number | null;
  smile_pct: number | null;
  head_motion_dps: number | null;
  camera_turns: number;
}

export function aggregateCamera(turns: { cameraMetrics: unknown }[]): AggregatedCamera {
  const parsed = turns.flatMap((t) => {
    const result = cameraMetricsSchema.safeParse(t.cameraMetrics);
    return result.success && result.data.frames > 0 ? [result.data] : [];
  });
  if (parsed.length === 0) {
    return { on_camera_pct: null, smile_pct: null, head_motion_dps: null, camera_turns: 0 };
  }

  const weights = parsed.map((m) => m.frames);
  const total = weights.reduce((a, b) => a + b, 0);
  const weighted = (sel: (m: (typeof parsed)[number]) => number) =>
    round(parsed.reduce((a, m, i) => a + sel(m) * weights[i]!, 0) / total);

  return {
    on_camera_pct: weighted((m) => m.on_camera_pct),
    smile_pct: weighted((m) => m.smile_pct),
    head_motion_dps: weighted((m) => m.head_motion_dps),
    camera_turns: parsed.length,
  };
}

export function combineDelivery(
  text: { wpm: number; avg_pause_ms: number; filler_count: number },
  acoustics: AggregatedAcoustics,
  camera: AggregatedCamera,
): DeliveryMetrics {
  return { ...text, ...acoustics, ...camera };
}

function round(n: number): number {
  return roundTo(n, 2);
}

function roundTo(n: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}
