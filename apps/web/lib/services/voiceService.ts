import "server-only";
import { createHash } from "node:crypto";
import type { Session, Turn } from "@repo/db";
import type { Persona } from "@repo/types";
import { config } from "@/lib/env";
import { PERSONA_GEMINI_VOICE, PERSONA_VOICE } from "@/lib/interviewMeta";
import { SPEECH_FORMAT, synthesize } from "@/lib/clients/ttsClient";
import { synthesizeGemini } from "@/lib/clients/geminiTtsClient";
import { headObject, presignGet, putObject } from "@/lib/storage/objectStore";
import { isLatinScript } from "@/lib/text/script";
import { toSessionContext } from "./sessionContext";
import * as budget from "./ttsBudget";

const URL_TTL_S = 3_600;

export type VoiceFallbackReason = "disabled" | "budget" | "provider" | "storage" | "language";

export type VoiceOutcome =
  | { url: string; provider: "orpheus"; cached: boolean }
  | { url: string; provider: "gemini"; cached: boolean }
  | { url: null; provider: "browser"; reason: VoiceFallbackReason };

export type VoicePayload = VoiceOutcome & { budget_remaining?: number };

function browser(reason: VoiceFallbackReason): VoiceOutcome {
  return { url: null, provider: "browser", reason };
}

export function spokenText(persona: Persona, question: string): string {
  const { direction } = PERSONA_VOICE[persona];
  return `${direction}${question.trim()}`.slice(0, config.tts.maxChars);
}

export { isLatinScript };

export function cacheKey(voice: string, text: string): string {
  const digest = createHash("sha256").update(`${config.tts.model}|${voice}|${text}`).digest("hex");
  return `${config.tts.cachePrefix}${digest}.${SPEECH_FORMAT}`;
}

export function geminiCacheKey(voice: string, text: string): string {
  const digest = createHash("sha256")
    .update(`${config.tts.geminiModel}|${voice}|${text}`)
    .digest("hex");
  return `${config.tts.geminiCachePrefix}${digest}.wav`;
}

function personaOf(session: Session): Persona {
  try {
    return toSessionContext(session).config.persona ?? "neutral";
  } catch (err) {
    console.warn(
      `[voice] session ${session.id} has an unreadable config; using the neutral voice:`,
      err instanceof Error ? err.message : err,
    );
    return "neutral";
  }
}

async function resolveOrpheus(
  turn: Turn,
  persona: Persona,
  text: string,
): Promise<VoiceOutcome | null> {
  const { voice } = PERSONA_VOICE[persona];

  if (!isLatinScript(turn.question)) {
    console.warn(
      `[voice] turn ${turn.turnIndex} is not in a script Orpheus can read; browser fallback`,
    );
    return browser("language");
  }

  const key = cacheKey(voice, text);

  try {
    if (await headObject(key)) {
      return { url: await presignGet(key, URL_TTL_S), provider: "orpheus", cached: true };
    }
  } catch (err) {
    console.warn(
      `[voice] cache lookup failed for turn ${turn.turnIndex}; browser fallback:`,
      err instanceof Error ? err.message : err,
    );
    return browser("storage");
  }

  if (!(await budget.tryConsume())) return null;

  try {
    const { bytes, mime } = await synthesize(text, voice);
    await putObject(key, bytes, mime);
    return { url: await presignGet(key, URL_TTL_S), provider: "orpheus", cached: false };
  } catch (err) {
    console.warn(
      `[voice] synthesis failed for turn ${turn.turnIndex}; browser fallback:`,
      err instanceof Error ? err.message : err,
    );
    return browser("provider");
  }
}

async function resolveGemini(turn: Turn, persona: Persona, text: string): Promise<VoiceOutcome> {
  const voice = PERSONA_GEMINI_VOICE[persona];
  const key = geminiCacheKey(voice, text);

  try {
    if (await headObject(key)) {
      return { url: await presignGet(key, URL_TTL_S), provider: "gemini", cached: true };
    }
  } catch (err) {
    console.warn(
      `[voice] gemini cache lookup failed for turn ${turn.turnIndex}; browser fallback:`,
      err instanceof Error ? err.message : err,
    );
    return browser("storage");
  }

  if (!(await budget.tryConsume(new Date(), "gemini"))) return browser("budget");

  try {
    const { bytes, mime } = await synthesizeGemini(text, voice);
    await putObject(key, bytes, mime);
    return { url: await presignGet(key, URL_TTL_S), provider: "gemini", cached: false };
  } catch (err) {
    console.warn(
      `[voice] gemini synthesis failed for turn ${turn.turnIndex}; browser fallback:`,
      err instanceof Error ? err.message : err,
    );
    return browser("provider");
  }
}

async function resolveAudio(session: Session, turn: Turn): Promise<VoiceOutcome> {
  if (!config.ttsConfigured && !config.geminiTtsConfigured) return browser("disabled");

  const persona = personaOf(session);
  const text = spokenText(persona, turn.question);
  if (!text.trim()) return browser("provider");

  let exhausted = false;

  if (config.ttsConfigured) {
    const orpheus = await resolveOrpheus(turn, persona, text);
    if (orpheus) return orpheus;
    exhausted = true;
  }

  if (!config.geminiTtsConfigured) return browser(exhausted ? "budget" : "disabled");

  return resolveGemini(turn, persona, text);
}

async function headroom(): Promise<number | undefined> {
  if (!config.ttsConfigured) return undefined;
  try {
    return await budget.remaining();
  } catch (err) {
    console.warn(
      "[voice] could not read the remaining TTS budget:",
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

export async function questionAudio(session: Session, turn: Turn): Promise<VoicePayload> {
  const outcome = await resolveAudio(session, turn);
  const left = await headroom();
  return left === undefined ? outcome : { ...outcome, budget_remaining: left };
}
