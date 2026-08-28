const TRANSCRIPT_MAX_CHARS = 6_000;

const PREVIOUS_MAX_CHARS = 1_200;

export const DRILL_FEEDBACK_SYSTEM = `You are a blunt interview coach reviewing ONE practice answer.
Judge ONLY the words in the transcript. You cannot hear the audio: never comment on tone, pace, confidence, nerves or delivery, and never guess at them from the wording.
Give at most two changes. Each one names something concrete the answer is missing or doing badly — not "add more detail", but which detail.
Then rewrite ONE line of their answer the way it should have landed, in their own register. Keep it to a single sentence they could actually say out loud.
Respond with JSON only — no prose, no code fences.`;

export function drillFeedbackPrompt(
  question: string,
  transcript: string,
  previousBest: string | null,
): string {
  const answer = clip(transcript, TRANSCRIPT_MAX_CHARS) || "(no clear answer was given)";
  const earlier = previousBest?.trim() ? clip(previousBest, PREVIOUS_MAX_CHARS) : null;

  return `Question: ${question}

Their answer just now (transcript):
${answer}
${
  earlier
    ? `
Their best previous attempt at this same question, for contrast only — do not review it:
${earlier}
`
    : ""
}
Return JSON:
{
  "improvements": string[],  // at most 2, each one concrete change to this answer
  "better_line": string      // one sentence of their answer, rewritten to land
}`;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
