from __future__ import annotations

import io
import logging

import numpy as np
import parselmouth
from parselmouth.praat import call
from pydub import AudioSegment

log = logging.getLogger("audio.analysis")

TARGET_SR = 16_000

PITCH_FLOOR, PITCH_CEIL = 75.0, 500.0

UPTALK_WINDOW_S = 0.35
UPTALK_MIN_FRAMES = 5
UPTALK_MIN_SEMITONES = 1.5
UPTALK_MIN_SLOPE_HZ_S = 60.0


def _load_mono_16k(data: bytes) -> parselmouth.Sound:
    seg = AudioSegment.from_file(io.BytesIO(data))
    seg = seg.set_frame_rate(TARGET_SR).set_channels(1)

    samples = np.array(seg.get_array_of_samples()).astype(np.float64)
    max_val = float(1 << (8 * seg.sample_width - 1))
    if max_val > 0:
        samples /= max_val

    return parselmouth.Sound(samples, sampling_frequency=TARGET_SR)


def _measured(value: float, digits: int) -> float | None:
    number = float(value)
    if not np.isfinite(number):
        return None
    return round(number, digits)


def _voice_quality(sound: parselmouth.Sound) -> dict[str, float | None]:
    jitter: float | None = None
    shimmer: float | None = None
    hnr: float | None = None

    try:
        cycles = call(sound, "To PointProcess (periodic, cc)", PITCH_FLOOR, PITCH_CEIL)
        jitter = _measured(
            call(cycles, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3), 5
        )
        shimmer = _measured(
            call([sound, cycles], "Get shimmer (local)", 0, 0, 0.0001, 0.02, 1.3, 1.6),
            5,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("[analysis] jitter/shimmer unavailable for this clip: %s", exc)

    try:
        harmonicity = call(sound, "To Harmonicity (cc)", 0.01, PITCH_FLOOR, 0.1, 1.0)
        hnr = _measured(call(harmonicity, "Get mean", 0, 0), 2)
    except Exception as exc:  # noqa: BLE001
        log.warning("[analysis] harmonicity unavailable for this clip: %s", exc)

    return {"jitter_local": jitter, "shimmer_local": shimmer, "hnr_db": hnr}


def _uptalk(
    pitch: parselmouth.Pitch, sentence_ends: list[float] | None
) -> dict[str, int | None]:
    if sentence_ends is None:
        return {"uptalk_statements": None, "uptalk_rising": None}

    times = pitch.xs()
    f0 = pitch.selected_array["frequency"]
    statements = 0
    rising = 0

    for end in sentence_ends:
        window = (times >= end - UPTALK_WINDOW_S) & (times <= end) & (f0 > 0)
        if int(window.sum()) < UPTALK_MIN_FRAMES:
            continue

        t = times[window]
        f = f0[window]
        slope = float(np.polyfit(t, f, 1)[0])
        edge = max(2, len(f) // 3)
        semitones = float(12 * np.log2(np.median(f[-edge:]) / np.median(f[:edge])))

        statements += 1
        if slope > UPTALK_MIN_SLOPE_HZ_S and semitones > UPTALK_MIN_SEMITONES:
            rising += 1

    return {"uptalk_statements": statements, "uptalk_rising": rising}


def analyze(
    data: bytes, sentence_ends: list[float] | None = None
) -> dict[str, float | int | None]:
    sound = _load_mono_16k(data)

    pitch = sound.to_pitch()
    freqs = pitch.selected_array["frequency"]
    voiced = freqs[freqs > 0]

    if voiced.size > 0:
        mean_pitch = float(np.mean(voiced))
        pitch_variation = float(np.std(voiced))
    else:
        mean_pitch = 0.0
        pitch_variation = 0.0

    energy = float(sound.get_rms())

    out: dict[str, float | int | None] = {
        "pitch_variation": round(pitch_variation, 3),
        "energy": round(energy, 4),
        "mean_pitch_hz": round(mean_pitch, 2),
    }
    out.update(_voice_quality(sound))
    out.update(_uptalk(pitch, sentence_ends))
    return out
