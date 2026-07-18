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
/**
 * Gemini, even in JSON mode, sometimes returns an object or array where the
 * schema asks for a string (e.g. `"architecture": { "layers": [...] }`).
 * Rejecting it costs a whole retry and can dead-end the digest, so coerce
 * instead: stringify anything that isn't already a string.
 */
const looseString = z.preprocess(
  (v) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v)),
  z.string(),
);

/** Same tolerance for string[] fields: wrap a scalar, stringify each element. */
const looseStringArray = z.preprocess((v) => {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
}, z.array(z.string()));

export const projectDigestSchema = z.object({
  /**
   * What this project is, 2–4 sentences. NOT required to be non-empty: the model
   * sometimes returns everything else well but leaves this blank, and rejecting
   * the whole object over one field would throw away a good digest (and, after a
   * costly map phase, fall back to a raw dump). The service backfills a blank
   * summary from the repo metadata instead.
   */
  summary: looseString,
  tech_stack: looseStringArray,
  /** How the pieces fit, data flow. */
  architecture: looseString,
  key_features: looseStringArray,
  /** Models, schema, endpoints. */
  data_and_apis: looseString,
  /** Choices worth defending. */
  notable_decisions: looseStringArray,
  /** Weak spots, missing tests, TODOs — the best questions. */
  risks_and_gaps: looseStringArray,
  /** 5–10 angles an interviewer could open on. */
  question_seeds: looseStringArray,
});

export type ProjectDigest = z.infer<typeof projectDigestSchema>;

/**
 * MAP system prompt: summarise one slice of a larger codebase.
 *
 * Deliberately PLAIN TEXT, not JSON: the map output is only ever fed back into
 * the reduce step, and asking a model for structured JSON per chunk just invites
 * schema mismatches (Gemini returns nested objects) that fail the whole import.
 * Only the reduce step needs structure.
 */
export const PROJECT_MAP_SYSTEM =
  "You are analysing ONE slice of a larger codebase to help prepare an interviewer's brief. " +
  "Summarise what THIS slice reveals: components, key files, data models, endpoints, notable or " +
  "risky code, and anything worth grilling the author on. Be specific — name files, functions, and " +
  "decisions. It is fine if the slice is partial; only describe what is here. " +
  "Respond with a concise plain-text summary — no JSON, no code fences, no preamble.";

/**
 * REDUCE / single-pass system prompt. House style: name the failure modes,
 * demand specifics, JSON only. The material (a repo pack for a small repo, or
 * the combined chunk notes for a large one) goes in the user prompt.
 */
export const PROJECT_DIGEST_SYSTEM =
  "You are preparing an interviewer's brief on a codebase. From the material below, extract what " +
  "an interviewer needs to grill the person who built it. Be specific — name files, models, " +
  "endpoints, and decisions, not generalities. Flag anything that looks unfinished, risky, or " +
  "copy-pasted; those are the best questions.\n\n" +
  // Spell out the EXACT shape: in JSON mode Gemini otherwise invents its own key
  // names (project_overview, flagged_items, …), which then validate to nothing.
  "Respond with ONLY a single JSON object with EXACTLY these keys and types:\n" +
  "{\n" +
  '  "summary": string,            // what this project is, 2-4 sentences\n' +
  '  "tech_stack": string[],       // languages, frameworks, datastores, infra\n' +
  '  "architecture": string,       // how the pieces fit, data flow\n' +
  '  "key_features": string[],     // what it actually does\n' +
  '  "data_and_apis": string,      // models, schema, endpoints\n' +
  '  "notable_decisions": string[],// choices worth defending\n' +
  '  "risks_and_gaps": string[],   // weak spots, missing tests, TODOs, copy-paste\n' +
  '  "question_seeds": string[]    // 5-10 sharp angles an interviewer could open on\n' +
  "}\n" +
  "Use these exact key names. No other keys, no nesting, no prose, no code fences.";

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
