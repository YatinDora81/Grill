import type { StarBreakdown, StarLabel } from "@repo/types";

export const STAR_MAX_SENTENCES = 400;

export const STAR_SYSTEM = `You label the sentences of ONE interview answer with the part of the STAR structure each sentence serves.
S = Situation (context, background), T = Task (what they had to do / the goal), A = Action (what THEY personally did),
R = Result (outcome, numbers, what changed, what they learned), other = filler, meta-talk, asides, restating the question.
Label a sentence by the job it does in the answer, not by keywords it happens to contain. Every sentence gets exactly one label.
Do not judge how good the answer is, do not rewrite it, and do not comment on tone or confidence — you are splitting it, nothing more.
Respond with JSON only — no prose, no code fences.`;

export function starPrompt(question: string, sentences: string[]): string {
  const list = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `Question: ${question}

Answer, split into numbered sentences:
${list}

Return JSON:
{
  "labels": [ "S" | "T" | "A" | "R" | "other", ... ],   // exactly ${sentences.length} entries, one per sentence, in the same order
  "missing": [ "S" | "T" | "A" | "R" ],                 // the parts that never appear at all
  "note": string                                        // one dry sentence about how the answer's time is split, max 25 words
}`;
}

const PART_ORDER: readonly StarLabel[] = ["S", "T", "A", "R", "other"];

export function starFactsBlock(breakdowns: StarBreakdown[]): string {
  if (breakdowns.length === 0) return "";

  const rows = breakdowns.map((b) => {
    const split = PART_ORDER.map((k) => `${k} ${b.share[k]}%`).join(" · ");
    const missing = b.missing.length > 0 ? b.missing.join(", ") : "none";
    return `- turn ${b.turn_index} → ${split} · missing: ${missing}`;
  });

  return `STAR split of the behavioral answers (measured from each answer's own timestamps, facts):
${rows.join("\n")}
A lopsided split is worth naming in that turn's improvements — quote the figure rather than describing it vaguely.`;
}
