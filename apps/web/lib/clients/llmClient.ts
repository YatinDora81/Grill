import "server-only";
import type { GroundingSource } from "@repo/types";
import { config } from "@/lib/env";
import { AllKeysExhausted } from "@/lib/errors";
import { fetchWithTimeout, ensureOk } from "./http";
import { callWithRotation, geminiPool, groqPool } from "./keyPool";

export interface GenerateOpts {
  system?: string;
  prompt: string;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
  tools?: unknown[];
}

export interface GenerateResult {
  text: string;
  sources: GroundingSource[];
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GROQ_CHAT = "https://api.groq.com/openai/v1/chat/completions";

const NO_SOURCES: GroundingSource[] = [];

export function buildGeminiBody(opts: GenerateOpts): Record<string, unknown> {
  const grounded = Boolean(opts.tools?.length);
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      ...(opts.json && !grounded ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  if (grounded) body.tools = opts.tools;
  return body;
}

export function readGroundingSources(data: unknown): GroundingSource[] {
  const chunks = (
    data as
      | { candidates?: { groundingMetadata?: { groundingChunks?: unknown } }[] }
      | null
      | undefined
  )?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];

  const out: GroundingSource[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const web = (chunk as { web?: { uri?: unknown; title?: unknown } } | null)?.web;
    const uri = typeof web?.uri === "string" ? web.uri.trim() : "";
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    out.push({ uri, title: typeof web?.title === "string" ? web.title.trim() : "" });
  }
  return out;
}

async function geminiGenerate(key: string, opts: GenerateOpts): Promise<GenerateResult> {
  const url = `${GEMINI_BASE}/models/${config.gemini.model}:generateContent?key=${key}`;
  const body = buildGeminiBody(opts);

  const res = await ensureOk(
    await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      opts.timeoutMs,
    ),
    "gemini",
  );
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("gemini: empty completion");
  return { text, sources: readGroundingSources(data) };
}

async function groqChat(key: string, opts: GenerateOpts): Promise<GenerateResult> {
  const messages: { role: string; content: string }[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.prompt });
  const res = await ensureOk(
    await fetchWithTimeout(
      GROQ_CHAT,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: config.groq.llmFallbackModel,
          messages,
          temperature: opts.temperature ?? 0.7,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
      },
      opts.timeoutMs,
    ),
    "groq",
  );
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("groq: empty completion");
  return { text, sources: NO_SOURCES };
}

export async function generateTextWithSources(opts: GenerateOpts): Promise<GenerateResult> {
  try {
    return await callWithRotation(geminiPool, (key) => geminiGenerate(key, opts));
  } catch (err) {
    if (err instanceof AllKeysExhausted && !groqPool.isEmpty) {
      console.warn("[llmClient] Gemini pool exhausted — falling back to Groq.");
      if (opts.tools?.length) {
        console.warn("[llmClient] Groq cannot search the web — this answer is ungrounded.");
      }
      return await callWithRotation(groqPool, (key) => groqChat(key, opts));
    }
    throw err;
  }
}

export async function generateText(opts: GenerateOpts): Promise<string> {
  return (await generateTextWithSources(opts)).text;
}

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
