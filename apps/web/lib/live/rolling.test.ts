import { describe, expect, test } from "bun:test";
import {
  MAX_WPM,
  MIN_SPAN_MS,
  ROLLING_WINDOW_MS,
  rollingWpm,
  splitWords,
  trimSamples,
  type WordSample,
} from "./rolling";

const NOW = 100_000;
const at = (secondsAgo: number, words: number): WordSample => ({
  t: NOW - secondsAgo * 1_000,
  words,
});

describe("splitWords", () => {
  test("counts whitespace-separated words and ignores the gaps", () => {
    expect(splitWords("so the first thing I did")).toEqual([
      "so",
      "the",
      "first",
      "thing",
      "I",
      "did",
    ]);
  });

  test("survives the shapes interim recognition actually produces", () => {
    expect(splitWords("  we  shipped it   ")).toEqual(["we", "shipped", "it"]);
    expect(splitWords("")).toEqual([]);
    expect(splitWords("   ")).toEqual([]);
  });

  test("keeps punctuation attached rather than inventing extra words", () => {
    expect(splitWords("you know, it worked")).toEqual(["you", "know,", "it", "worked"]);
  });
});

describe("trimSamples", () => {
  test("drops everything older than the window and keeps the rest in order", () => {
    const samples = [at(45, 10), at(30, 40), at(12, 90), at(2, 120)];
    expect(trimSamples(samples, NOW)).toEqual([at(12, 90), at(2, 120)]);
  });

  test("keeps a sample sitting exactly on the boundary", () => {
    const onEdge = { t: NOW - ROLLING_WINDOW_MS, words: 5 };
    expect(trimSamples([onEdge], NOW)).toEqual([onEdge]);
    expect(trimSamples([{ t: NOW - ROLLING_WINDOW_MS - 1, words: 5 }], NOW)).toEqual([]);
  });

  test("honours a custom window", () => {
    const samples = [at(9, 20), at(4, 60)];
    expect(trimSamples(samples, NOW, 5_000)).toEqual([at(4, 60)]);
  });

  test("returns empty once every sample is stale, rather than the last one", () => {
    expect(trimSamples([at(60, 10), at(40, 30)], NOW)).toEqual([]);
  });

  test("never mutates the caller's list", () => {
    const samples = [at(45, 10), at(2, 120)];
    const copy = [...samples];
    trimSamples(samples, NOW);
    expect(samples).toEqual(copy);
  });
});

describe("rollingWpm", () => {
  test("measures the words that arrived across the window, not the ones already banked", () => {
    const samples = [at(30, 0), at(10, 60), at(0, 100)];
    expect(rollingWpm(samples, NOW)).toBe(240);
  });

  test("computes a plain rate over a full window", () => {
    expect(rollingWpm([at(20, 10), at(0, 60)], NOW)).toBe(150);
  });

  test("is null below the minimum span, because a short burst extrapolates to nonsense", () => {
    const justUnder = [
      { t: NOW - (MIN_SPAN_MS - 1), words: 0 },
      { t: NOW, words: 12 },
    ];
    expect(rollingWpm(justUnder, NOW)).toBeNull();

    const justOver = [
      { t: NOW - MIN_SPAN_MS, words: 0 },
      { t: NOW, words: 12 },
    ];
    expect(rollingWpm(justOver, NOW)).toBe(144);
  });

  test("is null with nothing to measure", () => {
    expect(rollingWpm([], NOW)).toBeNull();
    expect(rollingWpm([at(3, 8)], NOW)).toBeNull();
  });

  test("is null when the whole window has aged out during a silence", () => {
    expect(rollingWpm([at(60, 0), at(40, 90)], NOW)).toBeNull();
  });

  test("clamps an impossible rate instead of reporting it", () => {
    expect(rollingWpm([at(10, 0), at(0, 400)], NOW)).toBe(MAX_WPM);
  });

  test("clamps to zero when the word count goes backwards", () => {
    expect(rollingWpm([at(10, 80), at(0, 40)], NOW)).toBe(0);
  });

  test("rounds to a whole number, since the HUD has no room for decimals", () => {
    expect(
      rollingWpm(
        [
          { t: NOW - 7_000, words: 0 },
          { t: NOW, words: 25 },
        ],
        NOW,
      ),
    ).toBe(214);
  });

  test("honours a custom window", () => {
    const samples = [at(30, 0), at(10, 60), at(0, 100)];
    expect(rollingWpm(samples, NOW, 60_000)).toBe(200);
  });
});
