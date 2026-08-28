export interface WordSample {
  t: number;
  words: number;
}

export const ROLLING_WINDOW_MS = 20_000;

export const MIN_SPAN_MS = 5_000;

export const MAX_WPM = 300;

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function trimSamples(
  samples: readonly WordSample[],
  now: number,
  windowMs = ROLLING_WINDOW_MS,
): WordSample[] {
  const cutoff = now - windowMs;
  return samples.filter((s) => s.t >= cutoff);
}

export function rollingWpm(
  samples: readonly WordSample[],
  now: number,
  windowMs = ROLLING_WINDOW_MS,
): number | null {
  const window = trimSamples(samples, now, windowMs);
  const earliest = window[0];
  const latest = window[window.length - 1];
  if (!earliest || !latest) return null;

  const spanMs = latest.t - earliest.t;
  if (spanMs < MIN_SPAN_MS) return null;

  const spoken = latest.words - earliest.words;
  const wpm = spoken / (spanMs / 60_000);
  if (!Number.isFinite(wpm)) return null;

  return Math.round(Math.min(MAX_WPM, Math.max(0, wpm)));
}
