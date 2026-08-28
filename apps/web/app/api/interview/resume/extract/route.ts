export const runtime = "nodejs";

import { badRequest } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { extractResumeText } from "@/lib/services/resumeService";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`resume-extract:${userId}`, { limit: 20, windowMs: 60_000 });

    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESUME_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw badRequest("Résumé file is too large.", "resume_too_large");
    }

    const form = await req.formData();
    const file = form.get("resume");
    if (!(file instanceof File)) throw badRequest("Missing 'resume' file.", "missing_resume");
    if (file.size > MAX_RESUME_BYTES) {
      throw badRequest("Résumé file is too large.", "resume_too_large");
    }

    const text = await extractResumeText(
      new Uint8Array(await file.arrayBuffer()),
      file.type,
      file.name || "resume",
    );
    return json({ text, chars: text.length });
  } catch (err) {
    return errorResponse(err);
  }
}
