import type { AnswerScores, DeliveryMetrics, StarBreakdown } from "@repo/types";
import { difficultyLabel, interviewLabel } from "@/lib/interviewMeta";
import { starFactsBlock } from "./star";
import type { SessionContext } from "./questionGen";

export const REPORT_SYSTEM = `You write a candid, useful mock-interview report in Grill's voice:
honest, composed, dry — never cheerleading. Ground every claim in the candidate's ACTUAL words —
quote them. Do not invent examples. Delivery metrics (pace, pauses, pitch, energy, filler, voice
quality, uptalk, on-camera) are measured facts supplied to you: use them, but NEVER infer
tone/confidence from the transcript text.
Anything listed as NOT MEASURED is absent, not zero — say nothing about it, and never score it.
Jitter, shimmer and HNR are acoustic voice-quality measures: describe high jitter or shimmer as
"a less steady voice", never as "nervous". Uptalk is a measured count of statements that ended on
a rising pitch, not a judgement about confidence.
On-camera figures are measured from the candidate's webcam by software, not by a human. Describe
them as "looked at the camera", never as "confidence" or "engagement".
Respond with JSON only — no prose, no code fences.`;

export interface ReportTurn {
  turn_index: number;
  question: string;
  question_type: string;
  transcript: string;
  answer_scores: AnswerScores | null;
}

function deliveryBlock(d: DeliveryMetrics): string {
  const spoke = d.wpm > 0;
  const measured: string[] = [];
  const absent: string[] = [];

  (spoke ? measured : absent).push(spoke ? `- pace: ${d.wpm} wpm` : "pace");
  (spoke && d.avg_pause_ms > 0 ? measured : absent).push(
    spoke && d.avg_pause_ms > 0 ? `- average pause: ${d.avg_pause_ms} ms` : "average pause",
  );
  measured.push(`- filler words: ${d.filler_count}`);

  for (const [label, v, unit] of [
    ["pitch variation", d.pitch_variation, ""],
    ["energy", d.energy, ""],
    ["mean pitch", d.mean_pitch_hz, ""],
    ["jitter", d.jitter_local, ""],
    ["shimmer", d.shimmer_local, ""],
    ["voice clarity (HNR)", d.hnr_db, " dB"],
  ] as const) {
    if (v === null) absent.push(label);
    else measured.push(`- ${label}: ${v}${unit}`);
  }

  if (d.uptalk_pct === null) absent.push("uptalk");
  else {
    measured.push(
      `- uptalk: ${d.uptalk_rising} of ${d.uptalk_statements} statements ended on a rising pitch`,
    );
  }

  const audioAbsent = absent.length > 0;

  for (const [label, v, unit] of [
    ["time looking at the camera", d.on_camera_pct, "%"],
    ["time visibly smiling", d.smile_pct, "%"],
    ["head movement", d.head_motion_dps, " deg/s"],
  ] as const) {
    if (v === null) absent.push(label);
    else measured.push(`- ${label}: ${v}${unit}`);
  }

  const head = `Measured delivery metrics (facts):\n${measured.join("\n")}`;
  if (!absent.length) return head;

  const causes: string[] = [];
  if (audioAbsent) {
    causes.push(
      spoke
        ? "The audio analysis was unavailable for this session."
        : "This candidate typed their answers rather than speaking, so there is no audio to measure.",
    );
  }
  if (d.camera_turns === 0) {
    causes.push("The camera was off or blocked, so there is no on-camera measurement.");
  }
  causes.push(
    "Treat these as absent, not as zero: do not describe them, do not hold them against the candidate, and do not let them move any score.",
  );

  return `${head}\n\nNOT MEASURED — ${absent.join(", ")}. ${causes.join(" ")}`;
}

export function reportPrompt(
  s: SessionContext,
  turns: ReportTurn[],
  delivery: DeliveryMetrics,
  starBreakdown: StarBreakdown[] = [],
): string {
  const body = turns
    .map(
      (t) =>
        `[Turn ${t.turn_index}] (${t.question_type}) Q: ${t.question}\n` +
        `A: ${t.transcript || "(no clear answer)"}\n` +
        `Scores: ${t.answer_scores ? JSON.stringify(t.answer_scores) : "n/a"}`,
    )
    .join("\n\n");

  const stars = starFactsBlock(starBreakdown);

  return `Role: ${s.role ?? "(unspecified)"} · Difficulty: ${difficultyLabel(s.config.difficulty)} · Interview: ${interviewLabel(s.config)}

Full interview:
${body}
${stars ? `\n${stars}\n` : ""}
${deliveryBlock(delivery)}

Write the final report. The verdict must be one honest sentence. For every answered
turn, include coaching in question_feedback: 1–3 possible_answers (strong example
answers or angles — not a transcript of theirs), and 1–4 improvements (concrete
things to change or add in THEIR answer). Rank next_steps by how much each one
would raise THIS candidate's score if they did it — biggest gain first, so the
first step is the single highest-value thing they can change. Do not state or
estimate point values anywhere. Return JSON:
{
  "overall_score": number,                       // 0-100
  "verdict": string,                             // one honest sentence
  "category_scores": { "technical": number, "communication": number, "problem_solving": number },
  "strengths": [ { "point": string, "example": string } ],
  "weaknesses": [ { "point": string, "example": string, "fix": string } ],
  "best_answer":  { "turn_index": number, "quote": string, "why": string },
  "worst_answer": { "turn_index": number, "quote": string, "why": string },
  "next_steps": [ string ],                      // ranked: biggest score gain first
  "question_feedback": [
    {
      "turn_index": number,
      "possible_answers": [ string ],             // strong example answers / angles
      "improvements": [ string ]                  // what to change or add in their answer
    }
  ]
}`;
}
