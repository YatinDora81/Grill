import "server-only";
import { createHash } from "node:crypto";
import type { Session, Turn } from "@repo/db";
import type { Persona } from "@repo/types";
import { config } from "@/lib/env";
import { PERSONA_VOICE } from "@/lib/interviewMeta";
import { SPEECH_FORMAT, synthesize } from "@/lib/clients/ttsClient";
import { headObject, presignGet, putObject } from "@/lib/storage/objectStore";
import { toSessionContext } from "./sessionContext";
import * as budget from "./ttsBudget";

const URL_TTL_S = 3_600;

export type VoiceFallbackReason = "disabled" | "budget" | "provider" | "storage" | "language";

export type VoiceOutcome =
  | { url: string; provider: "orpheus"; cached: boolean }
  | { url: null; provider: "browser"; reason: VoiceFallbackReason };

export type VoicePayload = VoiceOutcome & { budget_remaining?: number };

function browser(reason: VoiceFallbackReason): VoiceOutcome {
  return { url: null, provider: "browser", reason };
}

export function spokenText(persona: Persona, question: string): string {
  const { direction } = PERSONA_VOICE[persona];
  return `${direction}${question.trim()}`.slice(0, config.tts.maxChars);
}

const NON_LATIN_TOLERANCE = 0.2;

export function isLatinScript(text: string): boolean {
  const letters = text.match(/\p{L}/gu);
  if (!letters?.length) return true;
  const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
  return nonLatin / letters.length <= NON_LATIN_TOLERANCE;
}

export function cacheKey(voice: string, text: string): string {
  const digest = createHash("sha256").update(`${config.tts.model}|${voice}|${text}`).digest("hex");
  return `${config.tts.cachePrefix}${digest}.${SPEECH_FORMAT}`;
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

async function resolveAudio(session: Session, turn: Turn): Promise<VoiceOutcome> {
  if (!config.ttsConfigured) return browser("disabled");

  const persona = personaOf(session);
  const { voice } = PERSONA_VOICE[persona];
  const text = spokenText(persona, turn.question);
  if (!text.trim()) return browser("provider");

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

  if (!(await budget.tryConsume())) return browser("budget");

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
