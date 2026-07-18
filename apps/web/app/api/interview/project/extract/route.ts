export const runtime = "nodejs";
// A map-reduce import (tarball download + up to ~25 LLM calls) legitimately runs
// tens of seconds; give it headroom over the platform default so a big repo
// doesn't 504 mid-import.
export const maxDuration = 60;
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
    // Tighter than the résumé limit: one import is a tarball download plus 1–25
    // LLM calls, so a handful per window is plenty and a hammer gets a 429.
    rateLimit(`project-extract:${userId}`, { limit: 5, windowMs: 10 * 60_000 });

    const { repo_url } = bodySchema.parse(await req.json());
    const result = await extractProject(repo_url);
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
