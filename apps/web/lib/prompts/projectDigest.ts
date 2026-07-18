import { z } from "zod";

/**
 * The interviewer's brief on a codebase.
 *
 * A raw repo pack is 50–80 KB; `firstQuestionPrompt` / `followUpPrompt` are
 * rebuilt and re-sent every single turn, so we pay one extraction-time LLM call
 * to compress the repo into this — rich enough to ground real questions, cheap
 * enough to re-send. Same economics as parsing a PDF once in resumeService.
 *
 * Everything but `summary` defaults to empty: a README-only or exotic repo may
 * legitimately have no schema or no notable decisions, and the pipeline must
 * degrade rather than fail the request.
 */
export const projectDigestSchema = z.object({
  /** What this project is, 2–4 sentences. */
  summary: z.string().min(1),
  tech_stack: z.array(z.string()).default([]),
  /** How the pieces fit, data flow. */
  architecture: z.string().default(""),
  key_features: z.array(z.string()).default([]),
  /** Models, schema, endpoints. */
  data_and_apis: z.string().default(""),
  /** Choices worth defending. */
  notable_decisions: z.array(z.string()).default([]),
  /** Weak spots, missing tests, TODOs — the best questions. */
  risks_and_gaps: z.array(z.string()).default([]),
  /** 5–10 angles an interviewer could open on. */
  question_seeds: z.array(z.string()).default([]),
});

export type ProjectDigest = z.infer<typeof projectDigestSchema>;

/**
 * System prompt for the digest call. House style: name the failure modes, demand
 * specifics, JSON only. The pack goes in the user prompt (see projectService).
 */
export const PROJECT_DIGEST_SYSTEM =
  "You are preparing an interviewer's brief on a codebase. From the repo pack below, extract what " +
  "an interviewer needs to grill the person who built it. Be specific — name files, models, " +
  "endpoints, and decisions, not generalities. Flag anything that looks unfinished, risky, or " +
  "copy-pasted; those are the best questions. Respond with JSON only — no prose, no code fences.";

/** A labelled section as one block, or nothing when the body is empty. */
function section(label: string, body: string): string[] {
  const trimmed = body.trim();
  return trimmed ? [`${label}:\n${trimmed}`] : [];
}

/** A labelled bullet list as one block, or nothing when the list is empty. */
function bullets(label: string, items: string[]): string[] {
  const clean = items.map((i) => i.trim()).filter(Boolean);
  return clean.length ? [`${label}:\n${clean.map((i) => `- ${i}`).join("\n")}`] : [];
}

/**
 * Render a validated digest to labelled plain text — text, because the user
 * edits it in a textarea and `contextBlock` embeds text, not JSON.
 *
 * `notePrefix` prepends a caller-supplied honesty line (fork provenance, a
 * truncated tree) so it rides at the top of the material the interviewer reads.
 */
export function renderDigest(digest: ProjectDigest, notePrefix?: string): string {
  const parts: string[] = [];
  if (notePrefix?.trim()) parts.push(notePrefix.trim());
  parts.push(
    ...section("Summary", digest.summary),
    ...bullets("Tech stack", digest.tech_stack),
    ...section("Architecture", digest.architecture),
    ...bullets("Key features", digest.key_features),
    ...section("Data and APIs", digest.data_and_apis),
    ...bullets("Notable decisions", digest.notable_decisions),
    ...bullets("Risks and gaps", digest.risks_and_gaps),
    ...bullets("Question seeds", digest.question_seeds),
  );
  return parts.join("\n\n");
}
