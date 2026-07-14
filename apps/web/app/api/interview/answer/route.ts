export const runtime = "nodejs";

import type { AnswerResponse } from "@repo/types";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { turnRefSchema } from "@/lib/schemas";
import { config } from "@/lib/env";
import { requireUserId } from "@/lib/auth";
import * as repo from "@/lib/db/repo";
import { processAnswer } from "@/lib/services/answerService";
import { transcribe } from "@/lib/clients/sttClient";
import { audioKey, putAudio } from "@/lib/storage/objectStore";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const form = await req.formData();
    const { session_id, turn_index } = turnRefSchema.parse({
      session_id: form.get("session_id"),
      turn_index: form.get("turn_index"),
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
    await putAudio(key, bytes, file.type);
    const { text, words } = await transcribe(bytes, `turn_${turn_index}.${ext}`, file.type);

    const result: AnswerResponse = await processAnswer({
      session,
      turnIndex: turn_index,
      transcript: text,
      words,
      audioKey: key,
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
