import { z } from "zod";

const looseString = z.preprocess(
  (v) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v)),
  z.string(),
);

const looseStringArray = z.preprocess((v) => {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
}, z.array(z.string()));

export const projectDigestSchema = z.object({
  summary: looseString,
  tech_stack: looseStringArray,
  architecture: looseString,
  key_features: looseStringArray,
  data_and_apis: looseString,
  notable_decisions: looseStringArray,
  risks_and_gaps: looseStringArray,
  question_seeds: looseStringArray,
});

export type ProjectDigest = z.infer<typeof projectDigestSchema>;

export const PROJECT_MAP_SYSTEM =
  "You are analysing ONE slice of a larger codebase to help prepare an interviewer's brief. " +
  "Summarise what THIS slice reveals: components, key files, data models, endpoints, notable or " +
  "risky code, and anything worth grilling the author on. Be specific — name files, functions, and " +
  "decisions. It is fine if the slice is partial; only describe what is here. " +
  "Respond with a concise plain-text summary — no JSON, no code fences, no preamble.";

export const PROJECT_DIGEST_SYSTEM =
  "You are preparing an interviewer's brief on a codebase. From the material below, extract what " +
  "an interviewer needs to grill the person who built it. Be specific — name files, models, " +
  "endpoints, and decisions, not generalities. Flag anything that looks unfinished, risky, or " +
  "copy-pasted; those are the best questions.\n\n" +
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

function section(label: string, body: string): string[] {
  const trimmed = body.trim();
  return trimmed ? [`${label}:\n${trimmed}`] : [];
}

function bullets(label: string, items: string[]): string[] {
  const clean = items.map((i) => i.trim()).filter(Boolean);
  return clean.length ? [`${label}:\n${clean.map((i) => `- ${i}`).join("\n")}`] : [];
}

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
