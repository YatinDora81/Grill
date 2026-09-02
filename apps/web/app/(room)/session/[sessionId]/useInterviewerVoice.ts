"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceResponse } from "@repo/types";
import { apiPost } from "@/lib/apiClient";
import { isLatinScript } from "@/lib/text/script";
import type { useSpeech } from "@/hooks/useSpeech";
import type { LocalVoice } from "@/hooks/useKokoro";

const VOICE_PATH = "/api/interview/voice";

const DEFAULT_LOCAL_VOICE = "af_heart";

export interface InterviewerVoice {
  speaking: boolean;
  endedAt: number | null;
  stop: () => void;
  replay: () => void;
  interject: (line: string) => void;
}

interface Options {
  sessionId: string;
  turnIndex: number;
  question: string;
  speech: ReturnType<typeof useSpeech>;
  delayMs: number;
  local?: LocalVoice | null;
  localVoice?: string;
}

function localCanSpeak(local: LocalVoice | null | undefined, question: string): boolean {
  return Boolean(local?.ready) && isLatinScript(question);
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
  const { sessionId, turnIndex, question, delayMs, speech, local, localVoice } = opts;
  const { speak, stop: stopBrowserVoice, muted, speaking: browserSpeaking } = speech;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [endedAt, setEndedAt] = useState<number | null>(null);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const localRef = useRef(local);
  localRef.current = local;

  const wasBrowserSpeaking = useRef(false);
  const interjecting = useRef(false);
  useEffect(() => {
    if (wasBrowserSpeaking.current && !browserSpeaking) {
      if (interjecting.current) interjecting.current = false;
      else setEndedAt(performance.now());
    }
    wasBrowserSpeaking.current = browserSpeaking;
  }, [browserSpeaking]);

  const interject = useCallback(
    (line: string) => {
      if (mutedRef.current || !line.trim()) return;
      interjecting.current = true;
      speak(line);
    },
    [speak],
  );

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.onplay = null;
      el.onended = null;
      el.onerror = null;
      el.pause();
      audioRef.current = null;
    }
    localRef.current?.stop();
    stopBrowserVoice();
    setSpeaking(false);
  }, [stopBrowserVoice]);

  const playUrl = useCallback(
    (url: string, fallbackText: string) => {
      stop();
      const el = new Audio(url);
      el.onplay = () => setSpeaking(true);
      el.onended = () => {
        setSpeaking(false);
        setEndedAt(performance.now());
      };
      el.onerror = () => {
        setSpeaking(false);
        setEndedAt(performance.now());
      };
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
    if (mutedRef.current) {
      setEndedAt(performance.now());
      return;
    }
    const localLane = localRef.current;
    if (
      localCanSpeak(localLane, question) &&
      localLane?.speak(question, localVoice ?? DEFAULT_LOCAL_VOICE, {
        onEnd: () => setEndedAt(performance.now()),
      })
    ) {
      return;
    }
    const url = urlRef.current;
    if (url) {
      playUrl(url, question);
      return;
    }
    speak(question);
  }, [playUrl, speak, question, localVoice]);

  useEffect(() => {
    let live = true;
    urlRef.current = null;
    setEndedAt(mutedRef.current ? performance.now() : null);

    const timer = setTimeout(() => {
      void (async () => {
        if (!localCanSpeak(localRef.current, question)) {
          try {
            const res = await requestVoice(sessionId, turnIndex);
            if (!live) return;
            urlRef.current = res.url;
          } catch {}
        }
        if (live) speakNow();
      })();
    }, delayMs);

    return () => {
      live = false;
      clearTimeout(timer);
      stop();
    };
  }, [sessionId, turnIndex, question, delayMs, speakNow, stop]);

  return {
    speaking: speaking || browserSpeaking || Boolean(local?.speaking),
    endedAt,
    stop,
    replay: speakNow,
    interject,
  };
}
