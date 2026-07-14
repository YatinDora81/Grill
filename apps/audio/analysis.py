"""Acoustic analysis via Parselmouth (Praat). BACKEND_README §2, §10.

The ONLY thing the JS API can't do: pitch + energy from the raw waveform.
Deterministic, no model, no API key, light RAM. One short clip at a time,
16 kHz mono, extract numbers, discard (§13).
"""

from __future__ import annotations

import io

import numpy as np
import parselmouth
from pydub import AudioSegment

TARGET_SR = 16_000


def _load_mono_16k(data: bytes) -> parselmouth.Sound:
    """Decode arbitrary audio (WebM/Opus, mp3, wav…) → 16 kHz mono Sound.

    Uses ffmpeg via pydub (ffmpeg is a SYSTEM dependency, not pip).
    """
    seg = AudioSegment.from_file(io.BytesIO(data))
    seg = seg.set_frame_rate(TARGET_SR).set_channels(1)

    samples = np.array(seg.get_array_of_samples()).astype(np.float64)
    # Normalise to [-1, 1] based on sample width.
    max_val = float(1 << (8 * seg.sample_width - 1))
    if max_val > 0:
        samples /= max_val

    return parselmouth.Sound(samples, sampling_frequency=TARGET_SR)


def analyze(data: bytes) -> dict[str, float]:
    """Return pitch variation, energy, and mean pitch for one clip."""
    sound = _load_mono_16k(data)

    pitch = sound.to_pitch()
    freqs = pitch.selected_array["frequency"]
    voiced = freqs[freqs > 0]  # drop unvoiced frames (0 Hz)

    if voiced.size > 0:
        mean_pitch = float(np.mean(voiced))
        pitch_variation = float(np.std(voiced))  # Hz; higher = less monotone
    else:
        mean_pitch = 0.0
        pitch_variation = 0.0

    # RMS energy (0..1-ish for normalised audio).
    energy = float(sound.get_rms())

    return {
        "pitch_variation": round(pitch_variation, 3),
        "energy": round(energy, 4),
        "mean_pitch_hz": round(mean_pitch, 2),
    }
