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

SYLLABLE_MIN_PITCH = 50.0
INTENSITY_STEP_S = 0.01
SILENCE_DB = -25.0
MIN_DIP_DB = 2.0
MIN_PAUSE_S = 0.3

TRAIL_TAIL_S = 0.35
TRAIL_MIN_BODY_S = 0.6
TRAIL_DROP_DB = 6.0

CLIP_LEVEL = 0.985


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


def _intensity(sound: parselmouth.Sound) -> parselmouth.Intensity:
    return sound.to_intensity(
        minimum_pitch=SYLLABLE_MIN_PITCH, time_step=INTENSITY_STEP_S
    )


def _sounding_mask(values: np.ndarray, threshold: float, step_s: float) -> np.ndarray:
    mask = np.isfinite(values) & (values > threshold)
    min_gap = max(1, int(round(MIN_PAUSE_S / step_s)))
    i = 0
    n = len(mask)
    while i < n:
        if mask[i]:
            i += 1
            continue
        j = i
        while j < n and not mask[j]:
            j += 1
        if i > 0 and j < n and (j - i) < min_gap:
            mask[i:j] = True
        i = j
    return mask


def _syllable_nuclei(
    sound: parselmouth.Sound, pitch: parselmouth.Pitch, intensity: parselmouth.Intensity
) -> dict[str, float | int | None]:
    empty: dict[str, float | int | None] = {
        "syllables": None,
        "speech_rate_sps": None,
        "articulation_rate_sps": None,
        "phonation_ratio": None,
    }
    values = intensity.values[0]
    times = intensity.xs()
    finite = values[np.isfinite(values)]
    if finite.size < 3:
        return empty

    threshold = float(np.quantile(finite, 0.99)) + SILENCE_DB
    threshold = max(threshold, float(np.min(finite)))

    step = float(intensity.dx)
    sounding = _sounding_mask(values, threshold, step)
    phonation_s = float(sounding.sum() * step)
    duration_s = float(sound.get_total_duration())

    peaks = [
        i
        for i in range(1, len(values) - 1)
        if np.isfinite(values[i])
        and values[i] > threshold
        and values[i] > values[i - 1]
        and values[i] >= values[i + 1]
    ]

    nuclei = 0
    for k, i in enumerate(peaks):
        stop = peaks[k + 1] if k + 1 < len(peaks) else len(values)
        segment = values[i:stop]
        segment = segment[np.isfinite(segment)]
        if segment.size == 0 or values[i] - float(np.min(segment)) < MIN_DIP_DB:
            continue
        f0 = pitch.get_value_at_time(float(times[i]))
        if f0 is None or not np.isfinite(f0) or f0 <= 0:
            continue
        nuclei += 1

    speaking = round(nuclei / duration_s, 3) if duration_s > 0 else None
    articulation = round(nuclei / phonation_s, 3) if phonation_s > 0 else None
    ratio = round(phonation_s / duration_s, 3) if duration_s > 0 else None

    return {
        "syllables": nuclei,
        "speech_rate_sps": speaking,
        "articulation_rate_sps": articulation,
        "phonation_ratio": ratio,
    }


def _trailing_off(
    intensity: parselmouth.Intensity, spans: list[tuple[float, float]] | None
) -> dict[str, int | None]:
    if not spans:
        return {"trailing_off_statements": None, "trailing_off_fading": None}

    values = intensity.values[0]
    times = intensity.xs()
    step = float(intensity.dx)
    min_body = max(3, int(round(TRAIL_MIN_BODY_S / step)))
    finite = np.isfinite(values)

    statements = 0
    fading = 0

    for start, end in spans:
        body_end = end - TRAIL_TAIL_S
        body_start = max(start, body_end - 3.0)
        tail = (times >= body_end) & (times <= end) & finite
        body = (times >= body_start) & (times < body_end) & finite
        if int(tail.sum()) < 3 or int(body.sum()) < min_body:
            continue

        statements += 1
        if float(np.mean(values[body])) - float(np.mean(values[tail])) >= TRAIL_DROP_DB:
            fading += 1

    return {"trailing_off_statements": statements, "trailing_off_fading": fading}


def _clipping_pct(sound: parselmouth.Sound) -> float:
    samples = sound.values[0]
    if samples.size == 0:
        return 0.0
    return round(float(np.mean(np.abs(samples) >= CLIP_LEVEL)) * 100.0, 3)


def analyze(
    data: bytes,
    sentence_ends: list[float] | None = None,
    sentence_spans: list[tuple[float, float]] | None = None,
) -> dict[str, float | int | None]:
    sound = _load_mono_16k(data)

    if sentence_ends is None and sentence_spans:
        sentence_ends = [end for _, end in sentence_spans]

    pitch = sound.to_pitch()
    intensity = _intensity(sound)
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
    out.update(_syllable_nuclei(sound, pitch, intensity))
    out.update(_trailing_off(intensity, sentence_spans))
    out["clipping_pct"] = _clipping_pct(sound)
    return out
