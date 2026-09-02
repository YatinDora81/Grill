export type MicVerdict = "good" | "quiet" | "noisy" | "clipping";

export interface MicAssessment {
  snrDb: number | null;
  verdict: MicVerdict;
  message: string;
}

export const MIC = { minSpeechRms: 0.02, minSnrDb: 12, maxClipped: 0.01 } as const;

export function assessMic(input: {
  noiseRms: number;
  speechRms: number;
  clippedFraction: number;
}): MicAssessment {
  const snrDb =
    input.noiseRms > 0 && input.speechRms > 0
      ? Math.round(20 * Math.log10(input.speechRms / input.noiseRms) * 10) / 10
      : null;
  if (input.clippedFraction > MIC.maxClipped) {
    return {
      snrDb,
      verdict: "clipping",
      message: "The mic is peaking. Move it back a little, or lower its gain.",
    };
  }
  if (input.speechRms < MIC.minSpeechRms) {
    return {
      snrDb,
      verdict: "quiet",
      message: "You're barely coming through. Move closer to the mic, or pick another one.",
    };
  }
  if (snrDb !== null && snrDb < MIC.minSnrDb) {
    return {
      snrDb,
      verdict: "noisy",
      message: "The room is loud next to your voice. Tone measurements will be rough.",
    };
  }
  return { snrDb, verdict: "good", message: "Clear signal." };
}
