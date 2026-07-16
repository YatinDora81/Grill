export const runtime = "nodejs";
// Optional: source_type = "resume" via file upload → extracted text for /start.

import { badRequest } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { extractResumeText } from "@/lib/services/resumeService";

/**
 * Far past any real CV, and deliberately not shared with the audio cap: a
 * résumé is a document, not a recording, and the two have no reason to move
 * together. /start only accepts 20k characters of text anyway, so anything
 * approaching this is not a résumé we could use.
 */
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

/** Slack for the multipart envelope, as in the answer route. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    // Per user, like the answer routes: parsing a PDF costs real CPU, and
    // unlike them nothing downstream bounds how often it can be paid.
    rateLimit(`resume-extract:${userId}`, { limit: 20, windowMs: 60_000 });

    // Refused on the declared length before formData() buffers the body — see
    // the answer route for why this is an early out and not the real cap.
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
