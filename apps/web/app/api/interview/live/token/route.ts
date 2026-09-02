export const runtime = "nodejs";

import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveTokenResponse } from "@repo/types";
import { conflict, notFound, serviceUnavailable } from "@/lib/errors";
import { json, errorResponse } from "@/lib/http";
import { sessionIdSchema } from "@/lib/schemas";
import { config } from "@/lib/env";
import { requireUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import * as repo from "@/lib/db/repo";
import { PERSONA_GEMINI_VOICE } from "@/lib/interviewMeta";
import { callWithRotation, geminiPool, ProviderError } from "@/lib/clients/keyPool";
import { toSessionContext } from "@/lib/services/sessionContext";
import { liveSystemInstruction } from "@/lib/prompts/live";
import { acquireLiveSlot } from "@/lib/services/liveService";

const TOKEN_GRACE_MINUTES = 5;
const NEW_SESSION_WINDOW_MS = 2 * 60_000;

function rotatable(err: unknown): unknown {
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  const status =
    typeof e?.status === "number" ? e.status : typeof e?.code === "number" ? e.code : null;
  if (status === null) return err;
  const message =
    typeof e.message === "string" && e.message.trim()
      ? e.message
      : "The live token request failed.";
  return new ProviderError(status, message);
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    await rateLimit(`live-token:${userId}`, { limit: 6, windowMs: 60_000 });
    if (!config.liveConfigured) {
      throw serviceUnavailable("Live mode is not enabled on this server.", "live_disabled");
    }

    const { session_id } = sessionIdSchema.parse(await req.json());
    const session = await repo.getSession(session_id, userId);
    if (!session) throw notFound("Session not found.", "unknown_session");
    if (session.status !== "in_progress") {
      throw conflict(`Session is ${session.status}.`, "session_not_active");
    }

    const ctx = toSessionContext(session);
    if (!ctx.config.live) throw conflict("This interview is not a live session.", "not_live");

    const opener = await repo.getTurn(session_id, 0);
    if (!opener) throw conflict("The interview has no opening question.", "unknown_turn");

    await acquireLiveSlot(session_id);

    const expireAt = new Date(Date.now() + (config.live.maxMinutes + TOKEN_GRACE_MINUTES) * 60_000);
    const newSessionBy = new Date(Date.now() + NEW_SESSION_WINDOW_MS);

    const token = await callWithRotation(geminiPool, async (key) => {
      const ai = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: "v1alpha" } });
      try {
        return await ai.authTokens.create({
          config: {
            uses: 1,
            expireTime: expireAt.toISOString(),
            newSessionExpireTime: newSessionBy.toISOString(),
            liveConnectConstraints: {
              model: config.live.model,
              config: {
                responseModalities: [Modality.AUDIO],
                systemInstruction: liveSystemInstruction(
                  ctx,
                  opener.question,
                  ctx.config.num_questions,
                ),
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: PERSONA_GEMINI_VOICE[ctx.config.persona ?? "neutral"],
                    },
                  },
                },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
              },
            },
            lockAdditionalFields: [],
          },
        });
      } catch (err) {
        throw rotatable(err);
      }
    });

    if (!token.name) {
      throw serviceUnavailable("Could not mint a live token.", "live_token_failed");
    }

    return json({
      token: token.name,
      model: config.live.model,
      expires_at: expireAt.toISOString(),
      opener: opener.question,
      max_minutes: config.live.maxMinutes,
    } satisfies LiveTokenResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
