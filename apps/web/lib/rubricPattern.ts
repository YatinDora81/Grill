import type { AnswerScores } from "@repo/types";

export const DIMENSIONS = ["relevance", "correctness", "structure", "depth", "filler"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const PATTERN: Record<Dimension, string> = {
  relevance:
    "The thing costing you the most is relevance — you answer a near-miss of the question rather than the question itself.",
  correctness:
    "The thing costing you the most is correctness — the substance is where you lose points, not the delivery.",
  structure:
    "The thing costing you the most is structure — your answers arrive as one long block instead of a shape an interviewer can follow.",
  depth:
    "The thing costing you the most is depth — you stop at the headline and leave the specifics that would prove it on the table.",
  filler:
    "The thing costing you the most is filler — the point is in there, but the ums and likes are burying it.",
};

export function worstDimension(scores: AnswerScores[]): Dimension | null {
  if (scores.length === 0) return null;

  let worst: Dimension | null = null;
  let worstMean = Infinity;
  for (const d of DIMENSIONS) {
    const mean = scores.reduce((sum, s) => sum + s[d], 0) / scores.length;
    if (mean < worstMean) {
      worstMean = mean;
      worst = d;
    }
  }
  return worst;
}

export function isAnswerScores(value: unknown): value is AnswerScores {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<Dimension, unknown>;
  return DIMENSIONS.every((k) => typeof s[k] === "number" && Number.isFinite(s[k]));
}
