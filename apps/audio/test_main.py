"""The upload ceiling.

/analyze is unauthenticated and this process is also the sweeper, so an
unbounded read here doesn't just fail the request — it takes the report backstop
down with it. These exercise the middleware rather than the handler, because the
whole point is refusing bytes that must never be accumulated.
"""

import pytest
from fastapi.testclient import TestClient

import main
from main import MAX_AUDIO_BYTES, MAX_UPLOAD_BYTES, MULTIPART_OVERHEAD_BYTES, app

client = TestClient(app)


def test_body_ceiling_leaves_room_for_the_multipart_envelope():
    # A clip exactly at the clip cap is legal to apps/web. If the body ceiling
    # were the same number, its own envelope would push it over and this service
    # would refuse a clip the caller was told was fine — with no way for the
    # caller to tell which end said no.
    assert MAX_UPLOAD_BYTES == MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES
    assert MAX_UPLOAD_BYTES > MAX_AUDIO_BYTES


def test_oversized_upload_is_refused_with_413():
    body = b"x" * (MAX_UPLOAD_BYTES + 1024)
    res = client.post("/analyze", files={"file": ("big.webm", body, "audio/webm")})
    assert res.status_code == 413


def test_oversized_upload_is_refused_by_declared_length_alone():
    # The declared length is enough to refuse on: reading the body to find out
    # how big it is would be doing the exact thing the cap exists to prevent.
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
    # Not asserting 200: the bytes are not real audio, so analysis fails on its
    # own terms. What matters is that the ceiling is not what stopped it.
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
