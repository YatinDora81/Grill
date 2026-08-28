import type { z } from "zod";
import { generateText, extractJson, type GenerateOpts } from "./llmClient";

export async function generateJson<T>(
  schema: z.ZodType<T>,
  opts: GenerateOpts,
): Promise<{ value: T; raw: string }> {
  const first = await generateText({ ...opts, json: true });
  const parsed = tryParse(schema, first);
  if (parsed.ok) return { value: parsed.value, raw: first };

  const retryPrompt =
    `${opts.prompt}\n\nYour previous response was not valid JSON matching the ` +
    `required schema. Respond with VALID JSON ONLY — no prose, no code fences.`;
  const second = await generateText({ ...opts, prompt: retryPrompt, json: true });
  const reparsed = tryParse(schema, second);
  if (reparsed.ok) return { value: reparsed.value, raw: second };

  throw new Error(`LLM did not return schema-valid JSON after retry: ${reparsed.error}`);
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
