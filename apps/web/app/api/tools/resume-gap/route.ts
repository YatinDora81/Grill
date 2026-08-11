export const runtime = "nodejs";
export const maxDuration = 60;

import type { ResumeGapResponse } from "@repo/types";
import { AllKeysExhausted, AppError, badRequest, serviceUnavailable } from "@/lib/errors";
import { ProviderError } from "@/lib/clients/keyPool";
import { json, errorResponse } from "@/lib/http";
import { resumeGapRequestSchema, resumeGapResponseSchema } from "@/lib/schemas";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { extractResumeText } from "@/lib/services/resumeService";
import { generateJson } from "@/lib/clients/llmJson";
import { RESUME_GAP_SYSTEM, resumeGapPrompt } from "@/lib/prompts/gap";

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;
const TOO_LARGE = "That file is too large — 5 MB is the ceiling.";

const ROUTE_BUDGET_MS = 50_000;
const GAP_TIMEOUT_MS = 20_000;
const MIN_GAP_MS = 5_000;

const BURST = {
  bucket: "gap",
  opts: { limit: 5, windowMs: 600_000 },
  message:
    "That is five comparisons in ten minutes — the ceiling for a tool with no account behind it. Come back in ten, or sign up and run a full interview.",
};

const DAILY = {
  bucket: "gap:day",
  opts: { limit: 10, windowMs: 86_400_000 },
  message:
    "That is ten comparisons today — the daily ceiling for a tool with no account behind it. Come back tomorrow, or sign up and run a full interview.",
};

function limit(req: Request, rule: typeof BURST): void {
  try {
    rateLimit(clientKey(req, rule.bucket), rule.opts);
  } catch (err) {
    if (err instanceof AppError && err.status === 429) {
      throw new AppError(429, err.code, rule.message);
    }
    throw err;
  }
}

export async function POST(req: Request) {
  const deadline = Date.now() + ROUTE_BUDGET_MS;
  try {
    limit(req, BURST);
    limit(req, DAILY);

    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESUME_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw badRequest(TOO_LARGE, "resume_too_large");
    }

    const form = await req.formData();
    const { jd, resume_text } = resumeGapRequestSchema.parse({
      jd: String(form.get("jd") ?? ""),
      resume_text: form.get("resume_text"),
    });

    const resumeText = await resumeTextFromForm(form, resume_text);
    const value = await compareResumeToJd(jd, resumeText, deadline);

    return json(value satisfies ResumeGapResponse);
  } catch (err) {
    return errorResponse(err);
  }
}

async function resumeTextFromForm(form: FormData, pasted: string | undefined): Promise<string> {
  const file = form.get("resume");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_RESUME_BYTES) throw badRequest(TOO_LARGE, "resume_too_large");
    try {
      return await extractResumeText(
        new Uint8Array(await file.arrayBuffer()),
        file.type,
        file.name || "resume",
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw badRequest(
        "Couldn't read that file — it may be corrupt or image-only. Paste the text instead.",
        "unreadable_resume",
      );
    }
  }
  if (pasted) return pasted;
  throw badRequest("Upload a résumé, or paste its text.", "missing_resume");
}

function callTimeout(deadline: number): number {
  return Math.min(GAP_TIMEOUT_MS, Math.max(MIN_GAP_MS, deadline - Date.now()));
}

async function compareResumeToJd(
  jd: string,
  resumeText: string,
  deadline: number,
): Promise<ResumeGapResponse> {
  try {
    const { value } = await generateJson(resumeGapResponseSchema, {
      system: RESUME_GAP_SYSTEM,
      prompt: resumeGapPrompt({ jd, resumeText }),
      temperature: 0.3,
      timeoutMs: callTimeout(deadline),
    });
    return value;
  } catch (err) {
    if (err instanceof AppError || err instanceof AllKeysExhausted) throw err;
    if (err instanceof ProviderError) throw err;
    console.error("[resume-gap] model output was not schema-valid after retry:", err);
    throw serviceUnavailable(
      "The comparison came back unreadable. Give it another go in a moment.",
      "gap_unreadable",
    );
  }
}
