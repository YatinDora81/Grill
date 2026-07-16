import type { AnswerScores, DeliveryMetrics } from "@repo/types";
import { difficultyLabel, interviewLabel } from "@/lib/interviewMeta";
import type { SessionContext } from "./questionGen";

export const REPORT_SYSTEM = `You write a candid, useful mock-interview report in Grill's voice:
honest, composed, dry — never cheerleading. Ground every claim in the candidate's ACTUAL words —
quote them. Do not invent examples. Delivery metrics (pace, pauses, pitch, energy, filler) are
measured facts supplied to you: use them, but NEVER infer tone/confidence from the transcript text.
Anything listed as NOT MEASURED is absent, not zero — say nothing about it, and never score it.
Respond with JSON only — no prose, no code fences.`;

export interface ReportTurn {
  turn_index: number;
  question: string;
  question_type: string;
  transcript: string;
  answer_scores: AnswerScores | null;
}

/**
 * Delivery, told apart from delivery-shaped absence.
 *
 * `wpm` and `avg_pause_ms` are `number`, not `number | null`, so "nobody spoke"
 * and "measured zero" are the same value — computeDelivery falls back to 0 when
 * there are no timed words at all. Delivery.tsx already refuses to print that 0
 * ("would read as 'monotone' instead of 'not measured'"), but the report LLM was
 * handed the raw object under a header calling it measured fact, while
 * REPORT_SYSTEM forbade it from noticing the answers were typed. A typed
 * interview was therefore graded for speaking at 0 wpm. Only wpm > 0 proves
 * anyone spoke, so it gates the pause figure too: no timed words means no gaps,
 * and a 0 there is the same absence wearing the same disguise.
 *
 * `filler_count` is counted from the transcript text, which exists either way,
 * so it is always measured.
 */
function deliveryBlock(d: DeliveryMetrics): string {
  const spoke = d.wpm > 0;
  const measured: string[] = [];
  const absent: string[] = [];

  (spoke ? measured : absent).push(spoke ? `- pace: ${d.wpm} wpm` : "pace");
  (spoke && d.avg_pause_ms > 0 ? measured : absent).push(
    spoke && d.avg_pause_ms > 0 ? `- average pause: ${d.avg_pause_ms} ms` : "average pause",
  );
  measured.push(`- filler words: ${d.filler_count}`);
  for (const [label, v] of [
    ["pitch variation", d.pitch_variation],
    ["energy", d.energy],
    ["mean pitch", d.mean_pitch_hz],
  ] as const) {
    if (v === null) absent.push(label);
    else measured.push(`- ${label}: ${v}`);
  }

  const head = `Measured delivery metrics (facts):\n${measured.join("\n")}`;
  if (!absent.length) return head;
  return `${head}\n\nNOT MEASURED — ${absent.join(", ")}. ${
    spoke
      ? "The audio analysis was unavailable for this session."
      : "This candidate typed their answers rather than speaking, so there is no audio to measure."
  } Treat these as absent, not as zero: do not describe them, do not hold them against the candidate, and do not let them move any score.`;
}

export function reportPrompt(
  s: SessionContext,
  turns: ReportTurn[],
  delivery: DeliveryMetrics,
): string {
  const body = turns
    .map(
      (t) =>
        `[Turn ${t.turn_index}] (${t.question_type}) Q: ${t.question}\n` +
        `A: ${t.transcript || "(no clear answer)"}\n` +
        `Scores: ${t.answer_scores ? JSON.stringify(t.answer_scores) : "n/a"}`,
    )
    .join("\n\n");

  // The bar this report grades against: Easy and Extreme answering the same
  // question are not the same performance, and the report has to know that.
  return `Role: ${s.role ?? "(unspecified)"} · Difficulty: ${difficultyLabel(s.config.difficulty)} · Interview: ${interviewLabel(s.config)}

Full interview:
${body}

${deliveryBlock(delivery)}

Write the final report. The verdict must be one honest sentence. Return JSON:
{
  "overall_score": number,                       // 0-100
  "verdict": string,                             // one honest sentence
  "category_scores": { "technical": number, "communication": number, "problem_solving": number },
  "strengths": [ { "point": string, "example": string } ],
  "weaknesses": [ { "point": string, "example": string, "fix": string } ],
  "best_answer":  { "turn_index": number, "quote": string, "why": string },
  "worst_answer": { "turn_index": number, "quote": string, "why": string },
  "next_steps": [ string ]
}`;
}
