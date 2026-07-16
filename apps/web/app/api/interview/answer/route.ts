export const runtime = "nodejs";

import type { AnswerResponse } from "@repo/types";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { turnRefSchema } from "@/lib/schemas";
import { config } from "@/lib/env";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/db/repo";
import { processAnswer } from "@/lib/services/answerService";
import { transcribe } from "@/lib/clients/sttClient";
import { audioKey, putAudio } from "@/lib/storage/objectStore";

/**
 * Slack for the multipart envelope — boundaries, part headers, the text fields —
 * so the Content-Length gate below never refuses a clip that is itself within
 * the cap. It only has to be generous enough to not fire early; file.size is
 * what actually decides.
 */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    // Shares one bucket with answer-text so a client can't double its budget by
    // alternating routes. Checked before formData() below, which would
    // otherwise buffer the whole upload before we decide to refuse it.
    rateLimit(`answer:${userId}`, { limit: 30, windowMs: 60_000 });

    // The file.size check further down is the real cap, but it can't run until
    // formData() has already pulled the entire body into memory — which is the
    // thing the cap exists to prevent. Refusing on the declared length first
    // means an oversized upload costs us nothing. It's client-supplied and
    // trivially omitted or lied about, so it narrows the window rather than
    // closing it; the post-parse check stays authoritative.
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > config.audio.maxBytes + MULTIPART_OVERHEAD_BYTES) {
      throw badRequest("Audio clip is too large.", "audio_too_large");
    }

    const form = await req.formData();
    const { session_id, turn_index, video_id, video_offset_ms } = turnRefSchema.parse({
      session_id: form.get("session_id"),
      turn_index: form.get("turn_index"),
      video_id: form.get("video_id"),
      video_offset_ms: form.get("video_offset_ms"),
    });

    const file = form.get("audio");
    if (!(file instanceof File)) throw badRequest("Missing 'audio' file.", "missing_audio");
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
      throw badRequest(`Unsupported content type: ${file.type}`, "bad_mime");
    }
    if (file.size > config.audio.maxBytes) {
      throw badRequest("Audio clip is too large.", "audio_too_large");
    }

    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");

    // Reject before the upload + STT below: processAnswer re-checks all of this,
    // but only after we've already paid for an R2 write and a Groq transcription.
    // A completed/cancelled session or a double-submitted turn shouldn't cost us.
    // (These mirror processAnswer's guards — keep the two in sync.)
    if (session.status !== "in_progress") {
      throw conflict(`Session is ${session.status}, not accepting answers.`, "session_not_active");
    }
    const existingTurn = await repo.getTurn(session_id, turn_index);
    if (!existingTurn) throw badRequest(`No question at turn_index ${turn_index}.`, "unknown_turn");
    if (existingTurn.transcript) {
      throw conflict(`Turn ${turn_index} was already answered.`, "turn_already_answered");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = extFromMime(file.type);
    const key = audioKey(session.id, turn_index, ext);

    // Save audio FIRST so downstream failures stay retryable.
    //
    // If the STT or scoring below throws, this object outlives the request with
    // no turn row naming it. That's deliberate — it is NOT cleaned up here. The
    // key is deterministic, so a retry of this turn overwrites it rather than
    // adding another, and deleting on failure would race a concurrent retry
    // that just wrote the same key successfully. Orphans are reaped by prefix
    // in purgeExpiredAudio, which is why that sweep lists R2 rather than
    // walking audioKey columns.
    await putAudio(key, bytes, file.type);
    const { text, words } = await transcribe(bytes, `turn_${turn_index}.${ext}`, file.type);

    const result: AnswerResponse = await processAnswer({
      session,
      turnIndex: turn_index,
      transcript: text,
      words,
      audioKey: key,
      videoId: video_id ?? null,
      videoOffsetMs: video_offset_ms ?? null,
    });
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

function extFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "webm";
}
