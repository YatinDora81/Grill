import "server-only";
import type {
  QuestionType,
  StarBreakdown,
  StarLabel,
  StarSegment,
  TranscriptWord,
} from "@repo/types";
import { generateJson } from "@/lib/clients/llmJson";
import { ANSWER_CAP_MODEL } from "@/lib/interviewMeta";
import { STAR_MAX_SENTENCES, STAR_SYSTEM, starPrompt } from "@/lib/prompts/star";
import { starResponseSchema } from "@/lib/schemas";

export interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

export interface StarTurn {
  turnIndex: number;
  question: string;
  questionType: QuestionType;
  transcript: string | null;
  transcriptWords: unknown;
}

const TERMINAL = /[.!?…]["')\]]*$/;
const MAX_SENTENCE_WORDS = 35;
const STAR_PARTS = ["S", "T", "A", "R"] as const;
const ALL_LABELS: readonly StarLabel[] = [...STAR_PARTS, "other"];

export function sentenceSpans(words: TranscriptWord[]): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  let buf: TranscriptWord[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    const text = buf
      .map((w) => w.word.trim())
      .filter(Boolean)
      .join(" ");
    if (text) out.push({ text, start: buf[0]!.start, end: buf[buf.length - 1]!.end });
    buf = [];
  };

  for (const w of words) {
    buf.push(w);
    if (TERMINAL.test(w.word.trim()) || buf.length >= MAX_SENTENCE_WORDS) flush();
  }
  flush();

  return out;
}

export function sentenceSpansFromText(text: string): SentenceSpan[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return sentenceSpans(tokens.map((t, i) => ({ word: t, start: i, end: i + 1 })));
}

function segmentWeights(segments: StarSegment[]): number[] {
  const raw = segments.map((s) => Math.max(0, s.end - s.start));
  const total = raw.reduce((a, b) => a + b, 0);
  return total > 0 ? raw : segments.map(() => 1);
}

function toShares(totals: Record<StarLabel, number>): Record<StarLabel, number> {
  const sum = ALL_LABELS.reduce((a, k) => a + totals[k], 0);
  const share = { S: 0, T: 0, A: 0, R: 0, other: 0 } as Record<StarLabel, number>;
  if (sum <= 0) return share;

  const tenths = ALL_LABELS.map((k) => (totals[k] / sum) * 1000);
  const floors = tenths.map((t) => Math.floor(t));
  let left = 1000 - floors.reduce((a, b) => a + b, 0);

  const byRemainder = ALL_LABELS.map((_, i) => i).sort(
    (a, b) => tenths[b]! - floors[b]! - (tenths[a]! - floors[a]!),
  );
  for (let i = 0; left > 0 && i < byRemainder.length; i++, left--) {
    floors[byRemainder[i]!] = floors[byRemainder[i]!]! + 1;
  }

  ALL_LABELS.forEach((k, i) => {
    share[k] = floors[i]! / 10;
  });
  return share;
}

export function starShares(
  spans: SentenceSpan[],
  labels: StarLabel[],
): { segments: StarSegment[]; share: Record<StarLabel, number> } {
  const segments: StarSegment[] = spans.map((s, i) => ({
    label: labels[i] ?? "other",
    start: s.start,
    end: s.end,
    text: s.text,
  }));

  const weights = segmentWeights(segments);
  const totals: Record<StarLabel, number> = { S: 0, T: 0, A: 0, R: 0, other: 0 };
  segments.forEach((seg, i) => {
    totals[seg.label] += weights[i]!;
  });

  return { segments, share: toShares(totals) };
}

function isBehavioral(t: StarTurn): boolean {
  return t.questionType === "cultural" || t.questionType === "behavioral";
}

function readWords(value: unknown): TranscriptWord[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const words: TranscriptWord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const w = raw as Partial<TranscriptWord>;
    if (typeof w.word !== "string" || typeof w.start !== "number" || typeof w.end !== "number") {
      return null;
    }
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) return null;
    words.push({ word: w.word, start: w.start, end: w.end });
  }
  return words;
}

export async function computeStarBreakdown(turns: StarTurn[]): Promise<StarBreakdown[]> {
  const targets = turns.filter((t) => isBehavioral(t) && (t.transcript ?? "").trim().length > 0);
  if (targets.length === 0) return [];

  const results: (StarBreakdown | null)[] = new Array(targets.length).fill(null);
  let next = 0;

  const worker = async () => {
    while (next < targets.length) {
      const i = next++;
      const turn = targets[i]!;
      try {
        results[i] = await breakdownFor(turn);
      } catch (err) {
        console.warn(`[starService] turn ${turn.turnIndex} not labelled:`, err);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(ANSWER_CAP_MODEL.concurrency, targets.length) }, worker),
  );

  return results.filter((r): r is StarBreakdown => r !== null);
}

async function breakdownFor(t: StarTurn): Promise<StarBreakdown | null> {
  const words = readWords(t.transcriptWords);
  const basis: StarBreakdown["basis"] = words ? "time" : "words";
  const all = words ? sentenceSpans(words) : sentenceSpansFromText(t.transcript ?? "");
  const spans = all.slice(0, STAR_MAX_SENTENCES);
  if (spans.length === 0) return null;

  const { value } = await generateJson(starResponseSchema, {
    system: STAR_SYSTEM,
    prompt: starPrompt(
      t.question,
      spans.map((s) => s.text),
    ),
    temperature: 0.1,
  });

  const labels: StarLabel[] = spans.map((_, i) => value.labels[i] ?? "other");
  const { segments, share } = starShares(spans, labels);

  return {
    turn_index: t.turnIndex,
    basis,
    segments,
    share,
    missing: STAR_PARTS.filter((p) => !segments.some((s) => s.label === p)),
    note: value.note,
  };
}
