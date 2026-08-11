export const runtime = "nodejs";

import { createHash, randomBytes } from "node:crypto";
import { badRequest, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { shareSessionParamsSchema } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth";
import { config } from "@/lib/env";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/db/repo";

const TOKEN_BYTES = 32;

const digest = (rawToken: string) => createHash("sha256").update(rawToken).digest("hex");

export async function POST(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const userId = await requireUserId();
    rateLimit(`share:${userId}`, { limit: 20, windowMs: 60_000 });
    const { sessionId } = shareSessionParamsSchema.parse(await params);

    const session = await repo.getSession(sessionId, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");
    if (session.status !== "completed") {
      throw badRequest("This interview has no finished report to share yet.", "no_report");
    }

    const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
    await repo.upsertReportShare(sessionId, digest(rawToken));

    return json({ url: `${config.site.url}/r/${rawToken}` });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    rateLimit(`share:${userId}`, { limit: 20, windowMs: 60_000 });
    const { sessionId } = shareSessionParamsSchema.parse(await params);

    const session = await repo.getSession(sessionId, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");

    const revoked = await repo.revokeReportShare(sessionId, userId);
    return json({ revoked });
  } catch (err) {
    return errorResponse(err);
  }
}
