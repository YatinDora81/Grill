import type { Persona } from "@repo/types";

export const HANDS_FREE = {
  silenceMs: 1_500,
  minTakeSeconds: 2,
  minSpokenMs: 700,
  graceAfterQuestionMs: 400,
  prefKey: "grill.handsfree",
} as const;

export const MAX_ANSWER_OFFSET_MS = 600_000;

export const INTERRUPT_AFTER_S: Record<Persona, number | null> = {
  neutral: null,
  friendly_screen: null,
  terse_staff: 75,
  bar_raiser: 100,
  skeptic: 120,
};

export const INTERRUPT_LINES: Record<Persona, string> = {
  neutral: "",
  friendly_screen: "",
  terse_staff: "Let me stop you there. What was the result?",
  bar_raiser: "I'll cut in. Give me the number that proves it.",
  skeptic: "Hold on. Which part of that actually shipped?",
};

export interface AutoStopInput {
  spoke: boolean;
  speaking: boolean;
  silenceMs: number;
  seconds: number;
  spokenMs: number;
}

export function shouldAutoStop(a: AutoStopInput): boolean {
  if (!a.spoke || a.speaking) return false;
  if (a.seconds < HANDS_FREE.minTakeSeconds) return false;
  if (a.spokenMs < HANDS_FREE.minSpokenMs) return false;
  return a.silenceMs >= HANDS_FREE.silenceMs;
}

export function shouldInterrupt(
  persona: Persona | null,
  seconds: number,
  handsFree: boolean,
): boolean {
  if (!handsFree) return false;
  const after = INTERRUPT_AFTER_S[persona ?? "neutral"];
  return after !== null && seconds >= after;
}

export function responseLatencyMs(
  answerOffsetMs: number | null | undefined,
  firstWordStartS: number | undefined,
): number | null {
  if (firstWordStartS === undefined || !Number.isFinite(firstWordStartS)) return null;
  const offset = answerOffsetMs && answerOffsetMs > 0 ? answerOffsetMs : 0;
  return Math.max(0, Math.round(offset + firstWordStartS * 1_000));
}

export function readHandsFreePref(): boolean {
  try {
    return localStorage.getItem(HANDS_FREE.prefKey) !== "0";
  } catch {
    return true;
  }
}

export function writeHandsFreePref(on: boolean): void {
  try {
    localStorage.setItem(HANDS_FREE.prefKey, on ? "1" : "0");
  } catch {}
}
