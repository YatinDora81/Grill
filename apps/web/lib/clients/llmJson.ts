import type { z } from "zod";
import type { GroundingSource } from "@repo/types";
import {
  generateText,
  generateTextWithSources,
  extractJson,
  type GenerateOpts,
} from "./llmClient";

const NO_SOURCES: GroundingSource[] = [];

export interface GenerateJsonResult<T> {
  value: T;
  raw: string;
  sources: GroundingSource[];
}

export async function generateJson<T>(
  schema: z.ZodType<T>,
  opts: GenerateOpts,
): Promise<GenerateJsonResult<T>> {
  const first = await call({ ...opts, json: true });
  const parsed = tryParse(schema, first.text);
  if (parsed.ok) return { value: parsed.value, raw: first.text, sources: first.sources };

  const retryPrompt =
    `${opts.prompt}\n\nYour previous response was not valid JSON matching the ` +
    `required schema. Respond with VALID JSON ONLY — no prose, no code fences.`;
  const second = await call({ ...opts, prompt: retryPrompt, json: true });
  const reparsed = tryParse(schema, second.text);
  if (reparsed.ok) return { value: reparsed.value, raw: second.text, sources: second.sources };

  throw new Error(`LLM did not return schema-valid JSON after retry: ${reparsed.error}`);
}

async function call(opts: GenerateOpts): Promise<{ text: string; sources: GroundingSource[] }> {
  if (opts.tools?.length) return await generateTextWithSources(opts);
  return { text: await generateText(opts), sources: NO_SOURCES };
}

function tryParse<T>(
  schema: z.ZodType<T>,
  text: string,
): { ok: true; value: T } | { ok: false; error: string } {
  try {
    const json = JSON.parse(extractJson(text));
    const result = schema.safeParse(json);
    if (result.success) return { ok: true, value: result.data };
    return { ok: false, error: result.error.message };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
