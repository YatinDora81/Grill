import { DIFFICULTY_META, difficultyLabel } from "@/lib/interviewMeta";
import { questionSystemProse, type SessionContext } from "./questionGen";

export const LIVE_CLOSING = "That's everything from my side. Thank you.";

export function liveSystemInstruction(
  s: SessionContext,
  opener: string,
  numQuestions: number,
): string {
  const c = s.config;
  const heat = DIFFICULTY_META[c.difficulty];
  const material = [
    c.topic ? `Topic: ${c.topic}` : "",
    c.job_description ? `Job description:\n${c.job_description.slice(0, 4_000)}` : "",
    s.sourceText ? `Résumé:\n${s.sourceText.slice(0, 6_000)}` : "",
    c.project_context ? `Project:\n${c.project_context.slice(0, 4_000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const framing = `${questionSystemProse(c)}

Difficulty: ${difficultyLabel(c.difficulty)}. ${heat.pitch}
Role: ${s.role ?? "(unspecified)"}

Candidate context:
${material || "(none — keep the questions general)"}`;

  return `${framing}

You are running a LIVE spoken interview. Rules:
- Open with exactly this question, then stop and listen: "${opener}"
- Ask ONE question at a time. Wait for the candidate to finish. Never answer for them.
- Keep acknowledgements to a few words; no praise, no summaries of their answer.
- Follow up on what they actually said; go deeper before moving on.
- Ask ${numQuestions} questions in total, counting the opener. After the candidate answers the last
  one, say exactly: "${LIVE_CLOSING}" and then say nothing more.
- If the candidate asks you to repeat, repeat the question verbatim.
- Do not read out lists, code or markdown. Speak like a person.`;
}
