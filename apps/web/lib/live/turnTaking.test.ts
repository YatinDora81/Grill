import { describe, expect, test } from "bun:test";
import {
  HANDS_FREE,
  INTERRUPT_AFTER_S,
  INTERRUPT_LINES,
  readHandsFreePref,
  responseLatencyMs,
  shouldAutoStop,
  shouldInterrupt,
  writeHandsFreePref,
  type AutoStopInput,
} from "./turnTaking";

const TALKING: AutoStopInput = {
  spoke: true,
  speaking: false,
  silenceMs: HANDS_FREE.silenceMs,
  seconds: 12,
  spokenMs: 9_000,
};

describe("shouldAutoStop", () => {
  test("a take nobody has spoken into is never submitted on silence alone", () => {
    expect(shouldAutoStop({ ...TALKING, spoke: false, spokenMs: 0, silenceMs: 30_000 })).toBe(
      false,
    );
  });

  test("mid-sentence silence does not count while the VAD still hears speech", () => {
    expect(shouldAutoStop({ ...TALKING, speaking: true })).toBe(false);
  });

  test("a take shorter than the floor is left alone, however quiet it goes", () => {
    expect(shouldAutoStop({ ...TALKING, seconds: HANDS_FREE.minTakeSeconds - 1 })).toBe(false);
  });

  test("a cough is not an answer: too little speech never auto-submits", () => {
    expect(shouldAutoStop({ ...TALKING, spokenMs: HANDS_FREE.minSpokenMs - 1 })).toBe(false);
  });

  test("real speech followed by the full silence window submits the take", () => {
    expect(shouldAutoStop(TALKING)).toBe(true);
    expect(shouldAutoStop({ ...TALKING, silenceMs: HANDS_FREE.silenceMs + 400 })).toBe(true);
  });

  test("a pause one tick short of the window is still a pause", () => {
    expect(shouldAutoStop({ ...TALKING, silenceMs: HANDS_FREE.silenceMs - 1 })).toBe(false);
  });
});

describe("shouldInterrupt", () => {
  test("the neutral interviewer never cuts anyone off", () => {
    expect(shouldInterrupt("neutral", 600, true)).toBe(false);
    expect(shouldInterrupt(null, 600, true)).toBe(false);
    expect(shouldInterrupt("friendly_screen", 600, true)).toBe(false);
  });

  test("terse_staff cuts in at 75 seconds and not before", () => {
    expect(shouldInterrupt("terse_staff", 74, true)).toBe(false);
    expect(shouldInterrupt("terse_staff", 75, true)).toBe(true);
    expect(shouldInterrupt("terse_staff", 200, true)).toBe(true);
  });

  test("every persona that interrupts has a line to say it with", () => {
    for (const [persona, after] of Object.entries(INTERRUPT_AFTER_S)) {
      const line = INTERRUPT_LINES[persona as keyof typeof INTERRUPT_LINES];
      expect(line === "").toBe(after === null);
    }
  });

  test("hands-free off means nobody is ever cut off", () => {
    expect(shouldInterrupt("terse_staff", 300, false)).toBe(false);
    expect(shouldInterrupt("bar_raiser", 300, false)).toBe(false);
  });
});

describe("responseLatencyMs", () => {
  test("a take Whisper found no words in has no latency, not a zero", () => {
    expect(responseLatencyMs(300, undefined)).toBeNull();
    expect(responseLatencyMs(300, Number.NaN)).toBeNull();
  });

  test("the gap is the mic offset plus the first word's start", () => {
    expect(responseLatencyMs(300, 0.8)).toBe(1_100);
  });

  test("a clock that ran backwards clamps to zero rather than going negative", () => {
    expect(responseLatencyMs(-500, 0.2)).toBe(200);
    expect(responseLatencyMs(null, 0)).toBe(0);
    expect(responseLatencyMs(undefined, 0.25)).toBe(250);
  });
});

describe("the hands-free preference", () => {
  test("defaults to on, and only an explicit off turns it off", () => {
    localStorage.removeItem(HANDS_FREE.prefKey);
    expect(readHandsFreePref()).toBe(true);

    writeHandsFreePref(false);
    expect(localStorage.getItem(HANDS_FREE.prefKey)).toBe("0");
    expect(readHandsFreePref()).toBe(false);

    writeHandsFreePref(true);
    expect(readHandsFreePref()).toBe(true);
  });
});
