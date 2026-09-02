import "server-only";
import type { AcousticMetrics, DeliveryMetrics, TranscriptWord } from "@repo/types";
import { cameraMetricsSchema, type CameraMetricsInput } from "@/lib/schemas";
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

function statements(words: TranscriptWord[] | null) {
  if (!words || words.length === 0) return [];
  return sentenceSpans(words).filter((span) => {
    const text = span.text.trim();
    if (QUESTION_ENDING.test(text)) return false;
    return text.split(/\s+/).filter(Boolean).length >= MIN_STATEMENT_WORDS;
  });
}

export function statementEnds(words: TranscriptWord[] | null): number[] {
  return statements(words).map((span) => span.end);
}

export interface StatementSpan {
  start: number;
  end: number;
}

export function statementSpans(words: TranscriptWord[] | null): StatementSpan[] {
  return statements(words).map((span) => ({ start: span.start, end: span.end }));
}

export async function analyzeAcoustics(
  audio: Uint8Array,
  filename: string,
  mime: string,
  sentenceEnds?: number[] | null,
  spans?: StatementSpan[] | null,
): Promise<AcousticMetrics | null> {
  try {
    const form = new FormData();
    form.append("file", new Blob([audio as unknown as BlobPart], { type: mime }), filename);
    if (sentenceEnds && sentenceEnds.length > 0) {
      form.append("sentence_ends", JSON.stringify(sentenceEnds));
    }
    if (spans && spans.length > 0) {
      form.append("sentence_spans", JSON.stringify(spans.map((s) => [s.start, s.end])));
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
    syllables: num(m.syllables),
    speech_rate_sps: num(m.speech_rate_sps),
    articulation_rate_sps: num(m.articulation_rate_sps),
    phonation_ratio: num(m.phonation_ratio),
    trailing_off_statements: num(m.trailing_off_statements),
    trailing_off_fading: num(m.trailing_off_fading),
    clipping_pct: num(m.clipping_pct),
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
  articulation_rate_sps: number | null;
  speech_rate_sps: number | null;
  phonation_ratio: number | null;
  trailing_off_pct: number | null;
  trailing_off_statements: number;
  trailing_off_fading: number;
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
  articulation_rate_sps: null,
  speech_rate_sps: null,
  phonation_ratio: null,
  trailing_off_pct: null,
  trailing_off_statements: 0,
  trailing_off_fading: 0,
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
  const trailingStatements = present.reduce((a, m) => a + (m.trailing_off_statements ?? 0), 0);
  const trailingFading = present.reduce((a, m) => a + (m.trailing_off_fading ?? 0), 0);

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
    articulation_rate_sps: meanOf((m) => m.articulation_rate_sps ?? null, 3),
    speech_rate_sps: meanOf((m) => m.speech_rate_sps ?? null, 3),
    phonation_ratio: meanOf((m) => m.phonation_ratio ?? null, 3),
    trailing_off_pct:
      trailingStatements > 0 ? roundTo((trailingFading / trailingStatements) * 100, 2) : null,
    trailing_off_statements: trailingStatements,
    trailing_off_fading: trailingFading,
  };
}

export interface AggregatedPosture {
  slouch_pct: number | null;
  hands_to_face_pct: number | null;
  shoulder_tilt_deg: number | null;
  wrist_motion: number | null;
  posture_turns: number;
}

export interface AggregatedCamera extends AggregatedPosture {
  on_camera_pct: number | null;
  smile_pct: number | null;
  head_motion_dps: number | null;
  camera_turns: number;
}

const NO_POSTURE: AggregatedPosture = {
  slouch_pct: null,
  hands_to_face_pct: null,
  shoulder_tilt_deg: null,
  wrist_motion: null,
  posture_turns: 0,
};

const NO_CAMERA: AggregatedCamera = {
  on_camera_pct: null,
  smile_pct: null,
  head_motion_dps: null,
  camera_turns: 0,
  ...NO_POSTURE,
};

export function aggregateCamera(turns: { cameraMetrics: unknown }[]): AggregatedCamera {
  const parsed = turns.flatMap((t) => {
    const result = cameraMetricsSchema.safeParse(t.cameraMetrics);
    return result.success && result.data.frames > 0 ? [result.data] : [];
  });
  const postures = parsed.flatMap((m) => (m.posture && m.posture.frames > 0 ? [m.posture] : []));
  const posture = aggregatePosture(postures);

  if (parsed.length === 0) return { ...NO_CAMERA, ...posture };

  const weights = parsed.map((m) => m.frames);
  const total = weights.reduce((a, b) => a + b, 0);
  const weighted = (sel: (m: (typeof parsed)[number]) => number) =>
    round(parsed.reduce((a, m, i) => a + sel(m) * weights[i]!, 0) / total);

  return {
    on_camera_pct: weighted((m) => m.on_camera_pct),
    smile_pct: weighted((m) => m.smile_pct),
    head_motion_dps: weighted((m) => m.head_motion_dps),
    camera_turns: parsed.length,
    ...posture,
  };
}

type StoredPosture = NonNullable<CameraMetricsInput["posture"]>;

function aggregatePosture(postures: StoredPosture[]): AggregatedPosture {
  if (postures.length === 0) return NO_POSTURE;

  const weights = postures.map((p) => p.frames);
  const total = weights.reduce((a, b) => a + b, 0);
  const weighted = (sel: (p: StoredPosture) => number) =>
    round(postures.reduce((a, p, i) => a + sel(p) * weights[i]!, 0) / total);

  return {
    slouch_pct: weighted((p) => p.slouch_pct),
    hands_to_face_pct: weighted((p) => p.hands_to_face_pct),
    shoulder_tilt_deg: weighted((p) => p.shoulder_tilt_deg),
    wrist_motion: weighted((p) => p.wrist_motion),
    posture_turns: postures.length,
  };
}

export interface AggregatedLatency {
  response_latency_ms: number | null;
  interruptions: number;
}

export const NO_LATENCY: AggregatedLatency = { response_latency_ms: null, interruptions: 0 };

export function aggregateLatency(
  turns: { responseLatencyMs: number | null; interruptedAtS: number | null }[],
): AggregatedLatency {
  const values = turns.flatMap((t) => (t.responseLatencyMs === null ? [] : [t.responseLatencyMs]));
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2
        ? sorted[mid]!
        : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  return {
    response_latency_ms: median,
    interruptions: turns.filter((t) => t.interruptedAtS !== null).length,
  };
}

export function aggregateConfidence(turns: { transcriptConfidence: number | null }[]): number | null {
  const values = turns.flatMap((t) =>
    t.transcriptConfidence === null || !Number.isFinite(t.transcriptConfidence)
      ? []
      : [t.transcriptConfidence],
  );
  if (values.length === 0) return null;
  return roundTo(values.reduce((a, b) => a + b, 0) / values.length, 3);
}

export interface DeliveryExtras extends AggregatedLatency {
  transcriber_confidence: number | null;
}

export const NO_EXTRAS: DeliveryExtras = { ...NO_LATENCY, transcriber_confidence: null };

export function combineDelivery(
  text: { wpm: number; avg_pause_ms: number; filler_count: number },
  acoustics: AggregatedAcoustics,
  camera: AggregatedCamera,
  extras: DeliveryExtras = NO_EXTRAS,
): DeliveryMetrics {
  return { ...text, ...acoustics, ...camera, ...extras };
}

function round(n: number): number {
  return roundTo(n, 2);
}

function roundTo(n: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}
