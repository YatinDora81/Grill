import "server-only";
/**
 * LLM client (Grill §rotation). Owns the Gemini keys and rotates them; on full
 * exhaustion, falls back to the Groq pool for the same text task. Services
 * never touch keys — they call generateText / generateJson. Uses the providers'
 * REST APIs directly so the rotation layer fully controls per-call keys/timeouts.
 */
import { config } from "@/lib/env";
import { AllKeysExhausted } from "@/lib/errors";
import { fetchWithTimeout, ensureOk } from "./http";
import { callWithRotation, geminiPool, groqPool } from "./keyPool";

export interface GenerateOpts {
  system?: string;
  prompt: string;
  temperature?: number;
  json?: boolean;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GROQ_CHAT = "https://api.groq.com/openai/v1/chat/completions";

async function geminiGenerate(key: string, opts: GenerateOpts): Promise<string> {
  const url = `${GEMINI_BASE}/models/${config.gemini.model}:generateContent?key=${key}`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };

  const res = await ensureOk(
    await fetchWithTimeout(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    "gemini",
  );
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("gemini: empty completion");
  return text;
}

async function groqChat(key: string, opts: GenerateOpts): Promise<string> {
  const messages: { role: string; content: string }[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.prompt });
  const res = await ensureOk(
    await fetchWithTimeout(GROQ_CHAT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: config.groq.llmFallbackModel,
        messages,
        temperature: opts.temperature ?? 0.7,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    }),
    "groq",
  );
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("groq: empty completion");
  return text;
}

export async function generateText(opts: GenerateOpts): Promise<string> {
  try {
    return await callWithRotation(geminiPool, (key) => geminiGenerate(key, opts));
  } catch (err) {
    if (err instanceof AllKeysExhausted && !groqPool.isEmpty) {
      console.warn("[llmClient] Gemini pool exhausted — falling back to Groq.");
      return await callWithRotation(groqPool, (key) => groqChat(key, opts));
    }
    throw err;
  }
}

/** Strip ```json fences and any prose around the first JSON value. */
export function extractJson(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();
  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  const start =
    firstArr === -1 ? firstObj : firstObj === -1 ? firstArr : Math.min(firstObj, firstArr);
  if (start > 0) t = t.slice(start);
  const lastObj = t.lastIndexOf("}");
  const lastArr = t.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  if (end !== -1 && end < t.length - 1) t = t.slice(0, end + 1);
  return t.trim();
}
