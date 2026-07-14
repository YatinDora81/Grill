export const runtime = "nodejs";
// Optional: source_type = "resume" via file upload → extracted text for /start.

import { badRequest } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/auth";
import { extractResumeText } from "@/lib/services/resumeService";

export async function POST(req: Request) {
  try {
    await requireUserId();
    const form = await req.formData();
    const file = form.get("resume");
    if (!(file instanceof File)) throw badRequest("Missing 'resume' file.", "missing_resume");

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
