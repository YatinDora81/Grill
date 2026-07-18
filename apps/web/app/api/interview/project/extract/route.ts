export const runtime = "nodejs";
// Turns a GitHub repo URL into an editable project digest for /start. Mirrors
// resume/extract: the expensive ingestion happens once here; /start only ever
// takes text. The interview never talks to GitHub.

import { z } from "zod";
import { json, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { extractProject } from "@/lib/services/projectService";

const bodySchema = z.object({ repo_url: z.string().trim().url().max(500) });

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    // Tighter than the résumé limit: this fans out to ~30 GitHub calls plus one
    // LLM pass, so a handful per window is plenty and a hammer gets a 429.
    rateLimit(`project-extract:${userId}`, { limit: 5, windowMs: 10 * 60_000 });

    const { repo_url } = bodySchema.parse(await req.json());
    const result = await extractProject(repo_url);
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
