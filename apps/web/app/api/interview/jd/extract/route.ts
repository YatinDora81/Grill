export const runtime = "nodejs";
export const maxDuration = 30;

import type { JobImportResponse } from "@repo/types";
import { json, errorResponse } from "@/lib/http";
import { jdExtractRequestSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { importJob, importJobFromPageText } from "@/lib/services/jobImportService";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`jd-extract:${userId}`, { limit: 10, windowMs: 10 * 60_000 });

    const { url, page_title, page_text } = jdExtractRequestSchema.parse(await req.json());

    const result = page_text
      ? await importJobFromPageText({ url, pageTitle: page_title, pageText: page_text })
      : await importJob(url);

    return json(result satisfies JobImportResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
