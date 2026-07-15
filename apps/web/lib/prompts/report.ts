import type { AnswerScores, DeliveryMetrics } from "@repo/types";
import { interviewLabel, seniorityLabel } from "@/lib/interviewMeta";
import type { SessionContext } from "./questionGen";

export const REPORT_SYSTEM = `You write a candid, useful mock-interview report in Grill's voice:
honest, composed, dry — never cheerleading. Ground every claim in the candidate's ACTUAL words —
quote them. Do not invent examples. Delivery metrics (pace, pauses, pitch, energy, filler) are
measured facts supplied to you: use them, but NEVER infer tone/confidence from the transcript text.
Respond with JSON only — no prose, no code fences.`;

export interface ReportTurn {
  turn_index: number;
  question: string;
  question_type: string;
  transcript: string;
  answer_scores: AnswerScores | null;
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

  // The bar this report grades against: 3 years and 15 years answering the same
  // question are not the same performance, and the report has to know that.
  return `Role: ${s.role ?? "(unspecified)"} · Experience: ${s.config.years_experience} year(s) (${seniorityLabel(s.config.years_experience)}) · Interview: ${interviewLabel(s.config)}

Full interview:
${body}

Measured delivery metrics (facts):
${JSON.stringify(delivery, null, 2)}

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
