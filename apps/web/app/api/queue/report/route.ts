export const runtime = "nodejs";
export const maxDuration = 300;

import { badRequest } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { sessionIdSchema } from "@/lib/schemas";
import { verifyQstash } from "@/lib/queue/qstash";
import { claimAndBuild } from "@/lib/services/reportQueue";
import { VIDEO_FLUSH_GRACE_MS } from "@/lib/services/videoService";

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    await verifyQstash(req, raw);

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw badRequest("Queue message was not JSON.", "bad_message");
    }
    const { session_id } = sessionIdSchema.parse(payload);

    const outcome = await claimAndBuild(session_id, { videoGraceMs: VIDEO_FLUSH_GRACE_MS });
    if (outcome === "failed") {
      console.error(`[queue] report build for ${session_id} failed; asking QStash to retry`);
      return json({ session_id, outcome }, 500);
    }

    return json({ session_id, outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
