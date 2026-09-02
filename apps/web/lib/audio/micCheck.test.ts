import { describe, expect, test } from "bun:test";
import { MIC, assessMic } from "./micCheck";

const CLEAN = { noiseRms: 0.005, speechRms: 0.09, clippedFraction: 0 };

describe("assessMic", () => {
  test("a clear signal is named as one, and says nothing else", () => {
    const clear = assessMic(CLEAN);
    expect(clear.verdict).toBe("good");
    expect(clear.message).toBe("Clear signal.");
  });

  test("snr is 20 log10 of speech over noise, to a tenth of a decibel", () => {
    expect(assessMic({ ...CLEAN, speechRms: 0.1, noiseRms: 0.01 }).snrDb).toBe(20);
    expect(assessMic({ ...CLEAN, speechRms: 0.1, noiseRms: 0.05 }).snrDb).toBe(6);
    expect(assessMic({ ...CLEAN, speechRms: 0.06, noiseRms: 0.01 }).snrDb).toBe(15.6);
  });

  test("silence on either side leaves the ratio unmeasurable rather than infinite", () => {
    expect(assessMic({ noiseRms: 0, speechRms: 0.1, clippedFraction: 0 }).snrDb).toBe(null);
    expect(assessMic({ noiseRms: 0.01, speechRms: 0, clippedFraction: 0 }).snrDb).toBe(null);
  });

  test("a peaking mic is called first, because clipping ruins every other measurement", () => {
    const clipping = assessMic({ ...CLEAN, clippedFraction: MIC.maxClipped + 0.001 });
    expect(clipping.verdict).toBe("clipping");
    expect(clipping.message).toBe("The mic is peaking. Move it back a little, or lower its gain.");

    const quietAndClipping = assessMic({
      noiseRms: 0.05,
      speechRms: 0.001,
      clippedFraction: 0.5,
    });
    expect(quietAndClipping.verdict).toBe("clipping");
  });

  test("clipping right on the threshold is still a usable take", () => {
    expect(assessMic({ ...CLEAN, clippedFraction: MIC.maxClipped }).verdict).toBe("good");
  });

  test("a voice under the floor is quiet, whatever the room behind it is doing", () => {
    const quiet = assessMic({ ...CLEAN, speechRms: MIC.minSpeechRms - 0.001, noiseRms: 0.0001 });
    expect(quiet.verdict).toBe("quiet");
    expect(quiet.message).toBe(
      "You're barely coming through. Move closer to the mic, or pick another one.",
    );
    expect(assessMic({ ...CLEAN, speechRms: MIC.minSpeechRms }).verdict).toBe("good");
  });

  test("a loud room next to a loud enough voice is noisy, and says the tone will suffer", () => {
    const noisy = assessMic({ noiseRms: 0.05, speechRms: 0.1, clippedFraction: 0 });
    expect(noisy.verdict).toBe("noisy");
    expect(noisy.message).toBe(
      "The room is loud next to your voice. Tone measurements will be rough.",
    );
    expect(noisy.snrDb).toBeLessThan(MIC.minSnrDb);
  });

  test("a signal nothing could be compared against is not called noisy on a guess", () => {
    const noFloor = assessMic({ noiseRms: 0, speechRms: 0.1, clippedFraction: 0 });
    expect(noFloor.snrDb).toBe(null);
    expect(noFloor.verdict).toBe("good");
  });
});
