export const runtime = "nodejs";

import { z } from "zod";
import type { AnswerResponse, DesignReview, TranscriptWord } from "@repo/types";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { designActivitySchema } from "@/lib/schemas";
import { config } from "@/lib/env";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/db/repo";
import { processAnswer } from "@/lib/services/answerService";
import { payloadOf } from "@/lib/services/codingService";
import { designTranscript, reviewDesign } from "@/lib/services/designService";
import { transcribe } from "@/lib/clients/sttClient";
import { extFromMime } from "@/lib/audio/mime";
import {
  audioKey,
  designImageKey,
  designKey,
  putAudio,
  putObject,
} from "@/lib/storage/objectStore";

const IMAGE_MAX_BYTES = 4 * 1_024 * 1_024;
const SCENE_MAX_BYTES = 2 * 1_024 * 1_024;

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`answer:${userId}`, { limit: 30, windowMs: 60_000 });

    const form = await req.formData();
    const session_id = z.string().uuid().parse(form.get("session_id"));
    const turn_index = z.coerce.number().int().min(0).parse(form.get("turn_index"));

    const image = form.get("image");
    if (!(image instanceof File) || image.size === 0) {
      throw badRequest("Missing 'image' file.", "missing_image");
    }
    if (image.type !== "image/png") {
      throw badRequest(`Unsupported content type: ${image.type}`, "bad_mime");
    }
    if (image.size > IMAGE_MAX_BYTES) {
      throw badRequest("The board image is too large.", "image_too_large");
    }

    const rawScene = form.get("scene");
    if (typeof rawScene !== "string") throw badRequest("Missing 'scene'.", "missing_scene");
    if (rawScene.length > SCENE_MAX_BYTES) {
      throw badRequest("The board scene is too large.", "scene_too_large");
    }
    try {
      JSON.parse(rawScene);
    } catch {
      throw badRequest("'scene' is not JSON.", "bad_scene");
    }

    const rawEdits = form.get("edits");
    let activity: DesignReview["activity"];
    if (typeof rawEdits === "string" && rawEdits.length > 0) {
      try {
        activity = designActivitySchema.parse(JSON.parse(rawEdits));
      } catch {
        throw badRequest("'edits' is not JSON.", "bad_edits");
      }
    }

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
    if (question?.kind !== "design") {
      throw badRequest("This turn is not a design prompt.", "not_a_design_turn");
    }

    const png = new Uint8Array(await image.arrayBuffer());

    let sceneKey: string | null = null;
    let imageKey: string | null = null;
    if (config.storageConfigured) {
      imageKey = designImageKey(session.id, turn_index);
      sceneKey = designKey(session.id, turn_index);
      await putObject(imageKey, png, "image/png");
      await putObject(sceneKey, new TextEncoder().encode(rawScene), "application/json");
    } else {
      console.warn("[answer-design] storage is not configured — the board is reviewed, not kept.");
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
      if (config.storageConfigured) {
        key = audioKey(session.id, turn_index, ext);
        await putAudio(key, bytes, file.type);
      }
      const t = await transcribe(bytes, `turn_${turn_index}.${ext}`, file.type);
      words = t.words;
      spoken = t.text;
      confidence = t.confidence ?? null;
    }

    const { review, scores } = await reviewDesign(question, png, spoken);
    const stored: DesignReview = activity ? { ...review, activity } : review;

    const result: AnswerResponse = await processAnswer({
      session,
      turnIndex: turn_index,
      transcript: designTranscript(stored, spoken),
      words,
      audioKey: key,
      transcriptConfidence: confidence,
      answerScores: scores,
      designReview: stored,
      designKey: sceneKey,
      designImageKey: imageKey,
    });
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
