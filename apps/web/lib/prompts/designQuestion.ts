import type { DesignQuestionPayload } from "@repo/types";
import { DIFFICULTY_META, personaBrief } from "@/lib/interviewMeta";
import type { QuestionInputs, SessionContext } from "./questionGen";

export const DESIGN_SYSTEM = `You write ONE system-design interview prompt at a time for a mock interview.
Hard contract:
- Scoped to about 15 minutes at a whiteboard. One system, not a whole platform.
- State the scale in explicit numbers: users, requests per second, data size, read/write mix.
- Give 3-6 hard requirements, short lines, each one checkable on a diagram.
- Give 2-4 focus areas the interviewer will push on (storage choice, partitioning, caching,
  failure handling, consistency, cost).
- Grounded in the candidate's context when possible (their stack, their domain) but it must stand
  alone. No trivia, no "design Twitter" unless the context asks for it.
- Never sketch the answer: no component list, no suggested architecture.
Respond with JSON only — no prose, no code fences.`;

export function designQuestionPrompt(
  s: SessionContext,
  inputs: QuestionInputs,
  index: number,
  total: number,
): string {
  const heat = DIFFICULTY_META[s.config.difficulty];
  const persona = personaBrief(s.config.persona);
  const material = [
    s.config.topic ? `Topic: ${s.config.topic}` : "",
    s.config.job_description ? `Job description:\n${s.config.job_description.slice(0, 4_000)}` : "",
    s.sourceText ? `Résumé:\n${s.sourceText.slice(0, 6_000)}` : "",
    s.config.project_context ? `Project:\n${s.config.project_context.slice(0, 4_000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const asked = inputs.askedBefore?.length
    ? `\nDo not repeat these prompts (titles/prompts asked before):\n${inputs.askedBefore
        .slice(0, 40)
        .map((q) => `- ${q.slice(0, 160)}`)
        .join("\n")}\n`
    : "";
  return `Design prompt ${index + 1} of ${total}. Difficulty: ${heat.label} — ${heat.pitch}
${persona}
Role: ${s.role ?? "software engineer"}

Candidate context:
${material || "(none — pick a general system)"}
${asked}
Return JSON with exactly:
{
  "title": string,
  "prompt_markdown": string,           // the brief, in markdown; what to build and for whom; no solution
  "requirements": [string],            // 3-6 short checkable lines
  "scale": string,                     // e.g. "2M daily users, 8k writes/s, 40 TB of events"
  "focus": [string]                    // 2-4 areas the interviewer will push on
}`;
}

export const DESIGN_REVIEW_SYSTEM = `You are reviewing a system-design whiteboard (image) plus what the
candidate said. Identify only what is drawn or said — never invent components. If a box has no
label, say the box is unlabelled rather than guessing what it is. If the board is close to empty,
say so and score accordingly.
Score 0-10 per dimension:
- relevance: does the design address the stated requirements, not a different problem?
- correctness: would this design work at the stated scale?
- structure: clarity of the diagram — labelled boxes, data flow arrows, readable layout.
- depth: trade-offs, failure handling, capacity maths — drawn or spoken.
- filler: 10 minus vagueness; hand-waving and unnamed "service" boxes cost points.
The follow-up question must name a component the candidate actually drew or said.
Respond with JSON only — no prose, no code fences.`;

export function designReviewPrompt(q: DesignQuestionPayload, spoken: string): string {
  const requirements = q.requirements.length
    ? q.requirements.map((r) => `- ${r}`).join("\n")
    : "(none stated)";
  const focus = q.focus.length ? q.focus.join(", ") : "(none stated)";
  return `Prompt: ${q.title}
${q.prompt_markdown}

Requirements:
${requirements}
Scale: ${q.scale || "unspecified"}
Focus areas: ${focus}

The attached image is the whiteboard exactly as the candidate left it.

Spoken while drawing:
${spoken.trim() || "(said nothing)"}

Respond with JSON:
{
  "summary": string,                       // one or two sentences on what the board actually shows
  "components": [string],                  // the labelled things you can see or that were named
  "missing": [string],                     // requirements or pieces the board does not cover
  "single_points_of_failure": [string],    // where one box going down takes the system with it
  "scale_concerns": [string],              // where this design stops working at the stated scale
  "follow_up_question": string,            // ONE spoken question naming a component they drew or said
  "scores": { "relevance": n, "correctness": n, "structure": n, "depth": n, "filler": n }
}`;
}
