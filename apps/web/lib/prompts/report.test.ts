import { test, expect } from "bun:test";
import type { DeliveryMetrics } from "@repo/types";
import { REPORT_SYSTEM, reportPrompt } from "./report";
import type { ReportTurn } from "./report";
import type { SessionContext } from "./questionGen";

/**
 * `wpm: 0` is what computeDelivery returns when nobody spoke, and it is also
 * what a measured zero would look like — the type cannot tell them apart. The
 * report prompt is the last place that can, because REPORT_SYSTEM forbids the
 * model from noticing for itself that the answers were typed. So these tests are
 * about one thing: which numbers reach the model as facts, and which reach it
 * named as absent.
 */

const ctx: SessionContext = {
  sourceType: "resume",
  sourceText: "Staff engineer. Shipped a billing ledger on Postgres.",
  role: "Backend Engineer",
  config: {
    num_questions: 8,
    years_experience: 11,
    sources: ["resume"],
    mode: null,
    allow_repeats: false,
  },
};

const turns: ReportTurn[] = [
  {
    turn_index: 0,
    question: "How did you shard the ledger?",
    question_type: "technical",
    transcript: "We split it by tenant and kept a global sequence for invoices.",
    answer_scores: { relevance: 8, correctness: 7, structure: 6, depth: 7, filler: 9 },
  },
];

/** Everything measured. Each state below is this minus what it lost. */
const FULL: DeliveryMetrics = {
  wpm: 132,
  avg_pause_ms: 410,
  filler_count: 6,
  pitch_variation: 21.4,
  energy: 0.58,
  mean_pitch_hz: 118,
};

/** Typed answers: computeDelivery had no timed words and no audio at all. */
const TYPED: DeliveryMetrics = {
  wpm: 0,
  avg_pause_ms: 0,
  filler_count: 2,
  pitch_variation: null,
  energy: null,
  mean_pitch_hz: null,
};

/** They spoke; only the acoustic service failed. */
const NO_ACOUSTICS: DeliveryMetrics = { ...FULL, pitch_variation: null, energy: null, mean_pitch_hz: null };

const build = (d: DeliveryMetrics) => reportPrompt(ctx, turns, d);

test("a typed interview is never handed a pace or a pitch to grade", () => {
  const p = build(TYPED);

  // The bug: the whole object was JSON.stringified under "facts", so 0 wpm and
  // zero pitch variation read as a measured monotone drone.
  expect(p).not.toMatch(/\b0 wpm\b/);
  expect(p).not.toContain('"wpm": 0');
  expect(p).not.toMatch(/pace: /);
  expect(p).not.toMatch(/average pause: /);
  expect(p).not.toMatch(/pitch variation: /);
  expect(p).not.toMatch(/\bnull\b/);

  expect(p).toContain(
    "NOT MEASURED — pace, average pause, pitch variation, energy, mean pitch.",
  );
  // Naming the cause is the point: "missing" invites the model to guess.
  expect(p).toContain("typed their answers rather than speaking");
  expect(p).toContain("Treat these as absent, not as zero");
});

test("filler words survive typed answers, because they are counted from the text", () => {
  const p = build(TYPED);

  expect(p).toContain("Measured delivery metrics (facts):\n- filler words: 2");
  // The list of what's absent must not claim the one thing that was measured.
  expect(p.slice(p.indexOf("NOT MEASURED"))).not.toContain("filler");
});

test("a failed acoustic service costs the acoustics and nothing else", () => {
  const p = build(NO_ACOUSTICS);

  expect(p).toContain("- pace: 132 wpm");
  expect(p).toContain("- average pause: 410 ms");
  expect(p).toContain("- filler words: 6");

  expect(p).toContain("NOT MEASURED — pitch variation, energy, mean pitch.");
  // wpm > 0 proves someone spoke, so blaming typing here would be a lie the
  // model would repeat back to a candidate who talked for ten minutes.
  expect(p).toContain("The audio analysis was unavailable for this session.");
  expect(p).not.toContain("typed their answers");
});

test("a fully measured session is told about no absence at all", () => {
  const p = build(FULL);

  expect(p).not.toContain("NOT MEASURED");
  expect(p).not.toContain("audio analysis was unavailable");
  expect(p).toContain(
    "Measured delivery metrics (facts):\n" +
      "- pace: 132 wpm\n" +
      "- average pause: 410 ms\n" +
      "- filler words: 6\n" +
      "- pitch variation: 21.4\n" +
      "- energy: 0.58\n" +
      "- mean pitch: 118",
  );
});

test("silence in the middle of speech is reported, but a zero-pause zero is not", () => {
  // avg_pause_ms is gated on wpm, not on itself: a 0 with no speech behind it is
  // the same absence as pace, and must not be handed over as a fact.
  const p = build({ ...TYPED, filler_count: 0 });
  expect(p).not.toContain("average pause: 0 ms");
  expect(p).toContain("- filler words: 0");
});

test("the system prompt tells the model that NOT MEASURED means absent, not zero", () => {
  expect(REPORT_SYSTEM).toContain(
    "Anything listed as NOT MEASURED is absent, not zero — say nothing about it, and never score it.",
  );
  // The rule only holds while the model is still barred from reading tone off
  // the transcript — without that bar it would just infer the pace it wasn't given.
  expect(REPORT_SYSTEM).toContain("NEVER infer tone/confidence from the transcript text");
});
