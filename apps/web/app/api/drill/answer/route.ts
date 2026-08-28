export const runtime = "nodejs";

import type { DrillAnswerResponse } from "@repo/types";
import { badRequest } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { drillAudioAnswerSchema, drillTextAnswerSchema } from "@/lib/schemas";
import { config } from "@/lib/env";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { answerDrillCard } from "@/lib/services/drillService";
import { transcribe } from "@/lib/clients/sttClient";

const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`drill:${userId}`, { limit: 30, windowMs: 60_000 });

    const contentType = req.headers.get("content-type") ?? "";
    const { cardId, transcript } = contentType.includes("multipart/form-data")
      ? await fromAudio(req)
      : await fromText(req);

    const result = await answerDrillCard({ userId, cardId, transcript });
    return json(result satisfies DrillAnswerResponse);
  } catch (err) {
    return errorResponse(err);
  }
}

async function fromText(req: Request): Promise<{ cardId: string; transcript: string }> {
  const { card_id, text } = drillTextAnswerSchema.parse(await req.json());
  return { cardId: card_id, transcript: text };
}

async function fromAudio(req: Request): Promise<{ cardId: string; transcript: string }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > config.audio.maxBytes + MULTIPART_OVERHEAD_BYTES) {
    throw badRequest("Audio clip is too large.", "audio_too_large");
  }

  const form = await req.formData();
  const { card_id } = drillAudioAnswerSchema.parse({ card_id: form.get("card_id") });

  const file = form.get("audio");
  if (!(file instanceof File)) throw badRequest("Missing 'audio' file.", "missing_audio");
  if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
    throw badRequest(`Unsupported content type: ${file.type}`, "bad_mime");
  }
  if (file.size > config.audio.maxBytes) {
    throw badRequest("Audio clip is too large.", "audio_too_large");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extFromMime(file.type);
  const { text } = await transcribe(bytes, `drill.${ext}`, file.type);
  if (!text.trim()) throw badRequest("Nothing was said in that recording.", "empty_transcript");

  return { cardId: card_id, transcript: text };
}

function extFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "webm";
}
