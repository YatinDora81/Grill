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
import { extFromMime } from "@/lib/audio/mime";
import { audioKey, putAudio } from "@/lib/storage/objectStore";

const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`answer:${userId}`, { limit: 30, windowMs: 60_000 });

    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > config.audio.maxBytes + MULTIPART_OVERHEAD_BYTES) {
      throw badRequest("Audio clip is too large.", "audio_too_large");
    }

    const form = await req.formData();
    const {
      session_id,
      turn_index,
      video_id,
      video_offset_ms,
      camera_metrics,
      answer_offset_ms,
      interrupted_at_s,
    } = turnRefSchema.parse({
      session_id: form.get("session_id"),
      turn_index: form.get("turn_index"),
      video_id: form.get("video_id"),
      video_offset_ms: form.get("video_offset_ms"),
      camera_metrics: form.get("camera_metrics"),
      answer_offset_ms: form.get("answer_offset_ms"),
      interrupted_at_s: form.get("interrupted_at_s"),
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

    await putAudio(key, bytes, file.type);
    const { text, words, confidence } = await transcribe(
      bytes,
      `turn_${turn_index}.${ext}`,
      file.type,
    );

    const result: AnswerResponse = await processAnswer({
      session,
      turnIndex: turn_index,
      transcript: text,
      words,
      transcriptConfidence: confidence ?? null,
      audioKey: key,
      videoId: video_id ?? null,
      videoOffsetMs: video_offset_ms ?? null,
      cameraMetrics: camera_metrics ?? null,
      answerOffsetMs: answer_offset_ms ?? null,
      interruptedAtS: interrupted_at_s ?? null,
    });
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
