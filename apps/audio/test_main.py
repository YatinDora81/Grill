import io
import json
import struct
import wave

import numpy as np
import parselmouth
import pytest
from fastapi.testclient import TestClient

import analysis
import main
from main import MAX_AUDIO_BYTES, MAX_UPLOAD_BYTES, MULTIPART_OVERHEAD_BYTES, app

client = TestClient(app)

SR = analysis.TARGET_SR


def _wav_bytes(samples: np.ndarray) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(struct.pack(f"<{len(pcm)}h", *pcm.tolist()))
    return buffer.getvalue()


def _vowel(
    duration: float = 1.5,
    f0: float = 150.0,
    harmonics: int = 6,
    jitter: float = 0.0,
    shimmer: float = 0.0,
    noise: float = 0.0,
    seed: int = 1,
) -> np.ndarray:
    rng = np.random.default_rng(seed)
    count = int(duration * SR)
    period = int(SR / f0)
    cycles = count // period + 2

    instantaneous = np.full(count, f0)
    if jitter:
        instantaneous = f0 * (
            1 + np.repeat(rng.normal(0.0, jitter, cycles), period)[:count]
        )

    phase = 2 * np.pi * np.cumsum(instantaneous) / SR
    signal = np.zeros(count)
    for harmonic in range(1, harmonics + 1):
        signal += (1.0 / harmonic) * np.sin(harmonic * phase)
    signal /= np.max(np.abs(signal))

    if shimmer:
        signal *= 1 + np.repeat(rng.normal(0.0, shimmer, cycles), period)[:count]
    if noise:
        signal += rng.normal(0.0, noise, count)

    return signal * 0.5


def _tone(
    duration: float = 2.0,
    f0: float = 150.0,
    ends_at: float | None = None,
    ramp_s: float = 0.4,
) -> np.ndarray:
    count = int(duration * SR)
    times = np.arange(count) / SR
    instantaneous = np.full(count, f0)
    if ends_at is not None:
        start = duration - ramp_s
        ramping = times >= start
        instantaneous[ramping] = f0 + (ends_at - f0) * (
            (times[ramping] - start) / ramp_s
        )
    return 0.5 * np.sin(2 * np.pi * np.cumsum(instantaneous) / SR)


def _sound(samples: np.ndarray) -> parselmouth.Sound:
    return parselmouth.Sound(samples, sampling_frequency=SR)


def test_body_ceiling_leaves_room_for_the_multipart_envelope():
    assert MAX_UPLOAD_BYTES == MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES
    assert MAX_UPLOAD_BYTES > MAX_AUDIO_BYTES


def test_oversized_upload_is_refused_with_413():
    body = b"x" * (MAX_UPLOAD_BYTES + 1024)
    res = client.post("/analyze", files={"file": ("big.webm", body, "audio/webm")})
    assert res.status_code == 413


def test_oversized_upload_is_refused_by_declared_length_alone():
    res = client.post(
        "/analyze",
        headers={"content-length": str(MAX_UPLOAD_BYTES + 1)},
        content=b"x" * 128,
    )
    assert res.status_code == 413


def test_an_empty_upload_is_rejected_but_not_as_too_large():
    res = client.post("/analyze", files={"file": ("empty.webm", b"", "audio/webm")})
    assert res.status_code != 413
    assert res.status_code >= 400


def test_a_clip_within_the_cap_is_not_refused_by_the_ceiling():
    res = client.post("/analyze", files={"file": ("ok.webm", b"x" * 2048, "audio/webm")})
    assert res.status_code != 413


def test_the_clip_cap_follows_MAX_AUDIO_MB(monkeypatch):
    monkeypatch.setenv("MAX_AUDIO_MB", "3")
    assert main._max_audio_bytes() == 3 * 1024 * 1024


def test_a_junk_MAX_AUDIO_MB_falls_back_rather_than_crashing_the_service():
    import os

    os.environ["MAX_AUDIO_MB"] = "not-a-number"
    try:
        assert main._max_audio_bytes() == 25 * 1024 * 1024
    finally:
        os.environ.pop("MAX_AUDIO_MB", None)


def test_praat_undefined_becomes_null_rather_than_a_flattering_zero():
    assert analysis._measured(float("nan"), 5) is None
    assert analysis._measured(float("inf"), 5) is None
    assert analysis._measured(0.0123456, 5) == 0.01235
    assert analysis._measured(-5.881, 2) == -5.88


def test_a_silent_clip_reports_no_voice_quality_and_does_not_raise():
    quality = analysis._voice_quality(_sound(np.zeros(int(1.5 * SR))))
    assert quality == {"jitter_local": None, "shimmer_local": None, "hnr_db": None}


def test_a_clean_synthetic_vowel_is_steady_and_clear():
    quality = analysis._voice_quality(_sound(_vowel()))
    assert quality["jitter_local"] < 0.01
    assert quality["shimmer_local"] < 0.02
    assert quality["hnr_db"] > 20.0


def test_perturbing_the_vowel_moves_every_voice_quality_metric_the_right_way():
    clean = analysis._voice_quality(_sound(_vowel()))
    rough = analysis._voice_quality(
        _sound(_vowel(jitter=0.03, shimmer=0.15, noise=0.08, seed=7))
    )
    assert rough["jitter_local"] > clean["jitter_local"]
    assert rough["shimmer_local"] > clean["shimmer_local"]
    assert rough["hnr_db"] < clean["hnr_db"]


def test_noise_alone_lowers_clarity():
    clean = analysis._voice_quality(_sound(_vowel()))
    noisy = analysis._voice_quality(_sound(_vowel(noise=0.25, seed=3)))
    assert noisy["hnr_db"] < clean["hnr_db"] - 10.0


def test_a_rising_terminal_contour_counts_as_uptalk():
    pitch = _sound(_tone(ends_at=210.0)).to_pitch()
    assert analysis._uptalk(pitch, [2.0]) == {
        "uptalk_statements": 1,
        "uptalk_rising": 1,
    }


def test_a_flat_ending_is_judged_but_not_rising():
    pitch = _sound(_tone()).to_pitch()
    assert analysis._uptalk(pitch, [2.0]) == {
        "uptalk_statements": 1,
        "uptalk_rising": 0,
    }


def test_a_falling_ending_is_judged_but_not_rising():
    pitch = _sound(_tone(ends_at=110.0)).to_pitch()
    assert analysis._uptalk(pitch, [2.0]) == {
        "uptalk_statements": 1,
        "uptalk_rising": 0,
    }


def test_a_tiny_drift_upwards_is_not_a_rise():
    pitch = _sound(_tone(ends_at=158.0)).to_pitch()
    assert analysis._uptalk(pitch, [2.0])["uptalk_rising"] == 0


def test_an_ending_with_no_voiced_pitch_is_skipped_rather_than_counted():
    pitch = _sound(np.zeros(int(2 * SR))).to_pitch()
    assert analysis._uptalk(pitch, [2.0]) == {
        "uptalk_statements": 0,
        "uptalk_rising": 0,
    }


def test_no_sentence_ends_at_all_means_not_measured_not_zero():
    pitch = _sound(_tone(ends_at=210.0)).to_pitch()
    assert analysis._uptalk(pitch, None) == {
        "uptalk_statements": None,
        "uptalk_rising": None,
    }


def test_an_empty_sentence_end_list_is_a_real_measurement_of_nothing():
    pitch = _sound(_tone(ends_at=210.0)).to_pitch()
    assert analysis._uptalk(pitch, []) == {
        "uptalk_statements": 0,
        "uptalk_rising": 0,
    }


def test_a_caller_that_sends_no_sentence_ends_still_gets_every_other_metric():
    res = client.post(
        "/analyze", files={"file": ("clip.wav", _wav_bytes(_vowel()), "audio/wav")}
    )
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {
        "pitch_variation",
        "energy",
        "mean_pitch_hz",
        "jitter_local",
        "shimmer_local",
        "hnr_db",
        "uptalk_statements",
        "uptalk_rising",
    }
    assert body["energy"] > 0
    assert body["mean_pitch_hz"] > 0
    assert body["hnr_db"] is not None
    assert body["uptalk_statements"] is None
    assert body["uptalk_rising"] is None


def test_sentence_ends_travel_through_the_endpoint_as_whole_counts():
    res = client.post(
        "/analyze",
        files={"file": ("clip.wav", _wav_bytes(_tone(ends_at=210.0)), "audio/wav")},
        data={"sentence_ends": json.dumps([2.0])},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["uptalk_statements"] == 1
    assert body["uptalk_rising"] == 1
    assert isinstance(body["uptalk_statements"], int)
    assert isinstance(body["uptalk_rising"], int)


def test_a_silent_clip_answers_200_with_nulls_rather_than_praat_nans():
    res = client.post(
        "/analyze",
        files={"file": ("silence.wav", _wav_bytes(np.zeros(int(1.5 * SR))), "audio/wav")},
        data={"sentence_ends": json.dumps([1.0])},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["jitter_local"] is None
    assert body["shimmer_local"] is None
    assert body["hnr_db"] is None
    assert "NaN" not in res.text


@pytest.mark.parametrize(
    "raw",
    [
        "not json at all",
        '{"ends": [1.0]}',
        '["1.0"]',
        "[true]",
        "[-1.0]",
        '[1e400]',
        "[null]",
    ],
)
def test_a_malformed_sentence_ends_field_is_a_400(raw):
    res = client.post(
        "/analyze",
        files={"file": ("clip.wav", _wav_bytes(_vowel()), "audio/wav")},
        data={"sentence_ends": raw},
    )
    assert res.status_code == 400


def test_too_many_sentence_ends_is_a_400():
    res = client.post(
        "/analyze",
        files={"file": ("clip.wav", _wav_bytes(_vowel()), "audio/wav")},
        data={"sentence_ends": json.dumps([1.0] * (main.MAX_SENTENCE_ENDS + 1))},
    )
    assert res.status_code == 400


def test_an_empty_sentence_ends_field_is_read_as_absent():
    assert main._parse_sentence_ends("") is None
    assert main._parse_sentence_ends("   ") is None
    assert main._parse_sentence_ends(None) is None
    assert main._parse_sentence_ends("[]") == []
    assert main._parse_sentence_ends("[1, 2.5]") == [1.0, 2.5]
