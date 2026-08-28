"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceResponse } from "@repo/types";
import { apiPost } from "@/lib/apiClient";
import type { useSpeech } from "@/hooks/useSpeech";

const VOICE_PATH = "/api/interview/voice";

export interface InterviewerVoice {
  speaking: boolean;
  stop: () => void;
  replay: () => void;
}

interface Options {
  sessionId: string;
  turnIndex: number;
  question: string;
  speech: ReturnType<typeof useSpeech>;
  delayMs: number;
}

const inFlight = new Map<string, Promise<VoiceResponse>>();

function requestVoice(sessionId: string, turnIndex: number): Promise<VoiceResponse> {
  const key = `${sessionId}:${turnIndex}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = apiPost<VoiceResponse>(VOICE_PATH, {
    session_id: sessionId,
    turn_index: turnIndex,
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

export function prefetchQuestionAudio(sessionId: string, turnIndex: number): void {
  void requestVoice(sessionId, turnIndex).catch(() => {});
}

export function useInterviewerVoice(opts: Options): InterviewerVoice {
  const { sessionId, turnIndex, question, delayMs, speech } = opts;
  const { speak, stop: stopBrowserVoice, muted, speaking: browserSpeaking } = speech;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.onplay = null;
      el.onended = null;
      el.onerror = null;
      el.pause();
      audioRef.current = null;
    }
    stopBrowserVoice();
    setSpeaking(false);
  }, [stopBrowserVoice]);

  const playUrl = useCallback(
    (url: string, fallbackText: string) => {
      stop();
      const el = new Audio(url);
      el.onplay = () => setSpeaking(true);
      el.onended = () => setSpeaking(false);
      el.onerror = () => setSpeaking(false);
      audioRef.current = el;
      void el.play().catch(() => {
        audioRef.current = null;
        setSpeaking(false);
        speak(fallbackText);
      });
    },
    [stop, speak],
  );

  const speakNow = useCallback(() => {
    if (mutedRef.current) return;
    const url = urlRef.current;
    if (url) {
      playUrl(url, question);
      return;
    }
    speak(question);
  }, [playUrl, speak, question]);

  useEffect(() => {
    let live = true;
    urlRef.current = null;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await requestVoice(sessionId, turnIndex);
          if (!live) return;
          urlRef.current = res.url;
        } catch {}
        if (live) speakNow();
      })();
    }, delayMs);

    return () => {
      live = false;
      clearTimeout(timer);
      stop();
    };
  }, [sessionId, turnIndex, question, delayMs, speakNow, stop]);

  return { speaking: speaking || browserSpeaking, stop, replay: speakNow };
}
