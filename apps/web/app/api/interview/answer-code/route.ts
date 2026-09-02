export const runtime = "nodejs";

import { z } from "zod";
import type { AnswerResponse, TranscriptWord } from "@repo/types";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { codeAnswerPayloadSchema } from "@/lib/schemas";
import { config } from "@/lib/env";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/db/repo";
import { processAnswer } from "@/lib/services/answerService";
import {
  buildSubmission,
  codeTranscript,
  payloadOf,
  scoreCode,
} from "@/lib/services/codingService";
import { transcribe } from "@/lib/clients/sttClient";
import { extFromMime } from "@/lib/audio/mime";
import { audioKey, putAudio } from "@/lib/storage/objectStore";

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`answer:${userId}`, { limit: 30, windowMs: 60_000 });

    const form = await req.formData();
    const session_id = z.string().uuid().parse(form.get("session_id"));
    const turn_index = z.coerce.number().int().min(0).parse(form.get("turn_index"));

    const rawPayload = form.get("payload");
    if (typeof rawPayload !== "string") throw badRequest("Missing 'payload'.", "missing_payload");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawPayload);
    } catch {
      throw badRequest("'payload' is not JSON.", "bad_payload");
    }
    const payload = codeAnswerPayloadSchema.parse(parsedJson);

    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");
    if (session.status !== "in_progress") {
      throw conflict(`Session is ${session.status}, not accepting answers.`, "session_not_active");
    }

    const turn = await repo.getTurn(session_id, turn_index);
    if (!turn) throw badRequest(`No question at turn_index ${turn_index}.`, "unknown_turn");
    if (turn.transcript) {
      throw conflict(`Turn ${turn_index} was already answered.`, "turn_already_answered");
    }

    const question = payloadOf(turn);
    if (question?.kind !== "coding") {
      throw badRequest("This turn is not a coding problem.", "not_a_coding_turn");
    }

    let words: TranscriptWord[] | null = null;
    let spoken = "";
    let key: string | null = null;
    let confidence: number | null = null;

    const file = form.get("audio");
    if (file instanceof File && file.size > 0) {
      if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
        throw badRequest(`Unsupported content type: ${file.type}`, "bad_mime");
      }
      if (file.size > config.audio.maxBytes) {
        throw badRequest("Audio clip is too large.", "audio_too_large");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = extFromMime(file.type);
      key = audioKey(session.id, turn_index, ext);
      await putAudio(key, bytes, file.type);
      const t = await transcribe(bytes, `turn_${turn_index}.${ext}`, file.type);
      words = t.words;
      spoken = t.text;
      confidence = t.confidence ?? null;
    }

    const submission = buildSubmission(payload, words);
    const scores = await scoreCode(question, submission, spoken);

    const result: AnswerResponse = await processAnswer({
      session,
      turnIndex: turn_index,
      transcript: codeTranscript(submission, spoken),
      words,
      audioKey: key,
      transcriptConfidence: confidence,
      answerScores: scores,
      codeSubmission: submission,
    });
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
