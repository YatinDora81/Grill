"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@google/genai";
import type { LiveTokenResponse } from "@repo/types";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { base64ToFloat32, floatTo16BitPCM, int16ToBase64, resampleLinear } from "@/lib/audio/pcm";
import {
  EMPTY_LIVE_STATE,
  finaliseLive,
  reduceLiveMessage,
  type LiveLog,
  type LiveMessage,
  type LivePairingState,
} from "@/lib/live/pairing";

export type LiveState = "idle" | "connecting" | "live" | "ended" | "failed";

export type { LiveLog };

export interface GeminiLive {
  state: LiveState;
  error: string;
  modelSpeaking: boolean;
  userSpeaking: boolean;
  elapsedS: number;
  log: LiveLog[];
  liveQuestion: string;
  liveAnswer: string;
  level: number;
  start: () => Promise<void>;
  end: () => Promise<LiveLog[]>;
}

const CAPTURE_RATE = 16_000;
const PLAYBACK_RATE = 24_000;
const WORKLET_URL = "/worklets/pcm16-capture.js";
const SPEAKING_HOLD_MS = 800;
const DRAIN_MS = 2_000;
const SCHEDULE_LEAD_S = 0.02;

const GOING_AWAY = "The live session is about to close.";
const NO_MIC = "The microphone is blocked — allow it and try again.";
const CONNECT_FAILED = "The live interviewer would not connect.";

function reason(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error && err.message.trim()) return err.message;
  return CONNECT_FAILED;
}

export function useGeminiLive(sessionId: string, maxMinutes: number): GeminiLive {
  const [state, setState] = useState<LiveState>("idle");
  const [error, setError] = useState("");
  const [modelSpeaking, setModelSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [elapsedS, setElapsedS] = useState(0);
  const [log, setLog] = useState<LiveLog[]>([]);
  const [liveQuestion, setLiveQuestion] = useState("");
  const [liveAnswer, setLiveAnswer] = useState("");
  const [level, setLevel] = useState(0);

  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextTimeRef = useRef(0);
  const pairingRef = useRef<LivePairingState>(EMPTY_LIVE_STATE);
  const endedRef = useRef(false);
  const startedRef = useRef(false);
  const speakingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const endRef = useRef<() => Promise<LiveLog[]>>(async () => []);

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {}
    });
    sourcesRef.current = [];
    nextTimeRef.current = 0;
    setModelSpeaking(false);
  }, []);

  const teardown = useCallback(() => {
    if (speakingTimer.current) clearTimeout(speakingTimer.current);
    if (closingTimer.current) clearTimeout(closingTimer.current);
    if (tickTimer.current) clearInterval(tickTimer.current);
    speakingTimer.current = null;
    closingTimer.current = null;
    tickTimer.current = null;

    stopPlayback();

    try {
      nodeRef.current?.port.close();
      nodeRef.current?.disconnect();
    } catch {}
    nodeRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    void captureCtxRef.current?.close().catch(() => {});
    void playCtxRef.current?.close().catch(() => {});
    captureCtxRef.current = null;
    playCtxRef.current = null;

    try {
      sessionRef.current?.close();
    } catch {}
    sessionRef.current = null;
  }, [stopPlayback]);

  const end = useCallback(async (): Promise<LiveLog[]> => {
    const pairs = finaliseLive(pairingRef.current);
    if (endedRef.current) return pairs;
    endedRef.current = true;
    startedRef.current = false;
    teardown();
    setLog(pairs);
    setLiveQuestion("");
    setLiveAnswer("");
    setUserSpeaking(false);
    setState((s) => (s === "failed" ? s : "ended"));
    return pairs;
  }, [teardown]);

  endRef.current = end;

  const play = useCallback((chunks: string[]) => {
    const ctx = playCtxRef.current;
    if (!ctx || chunks.length === 0) return;
    void ctx.resume().catch(() => {});
    for (const chunk of chunks) {
      const pcm = base64ToFloat32(chunk);
      if (pcm.length === 0) continue;
      const buffer = ctx.createBuffer(1, pcm.length, PLAYBACK_RATE);
      buffer.getChannelData(0).set(pcm);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const at = Math.max(ctx.currentTime + SCHEDULE_LEAD_S, nextTimeRef.current);
      src.onended = () => {
        sourcesRef.current = sourcesRef.current.filter((s) => s !== src);
        if (sourcesRef.current.length === 0) setModelSpeaking(false);
      };
      sourcesRef.current.push(src);
      src.start(at);
      nextTimeRef.current = at + buffer.duration;
    }
    setModelSpeaking(true);
  }, []);

  const onMessage = useCallback(
    (msg: LiveMessage) => {
      const out = reduceLiveMessage(pairingRef.current, msg);
      pairingRef.current = out.state;

      if (out.interrupted) stopPlayback();
      else play(out.audio);

      setLog(out.state.log);
      setLiveQuestion(out.state.liveQuestion || out.state.pendingQuestion);
      setLiveAnswer(out.state.liveAnswer);

      if (out.heardUser) {
        setUserSpeaking(true);
        if (speakingTimer.current) clearTimeout(speakingTimer.current);
        speakingTimer.current = setTimeout(() => setUserSpeaking(false), SPEAKING_HOLD_MS);
      }

      if (out.goAway) {
        setError(GOING_AWAY);
        void endRef.current();
        return;
      }

      if (out.closing && !closingTimer.current) {
        closingTimer.current = setTimeout(() => void endRef.current(), DRAIN_MS);
      }
    },
    [play, stopPlayback],
  );

  const start = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    endedRef.current = false;
    pairingRef.current = EMPTY_LIVE_STATE;
    setState("connecting");
    setError("");

    try {
      const token = await apiPost<LiveTokenResponse>("/api/interview/live/token", {
        session_id: sessionId,
      });

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        throw new Error(NO_MIC);
      }
      streamRef.current = stream;

      const captureCtx = new AudioContext({ sampleRate: CAPTURE_RATE });
      captureCtxRef.current = captureCtx;
      if (captureCtx.state === "suspended") await captureCtx.resume().catch(() => {});
      await captureCtx.audioWorklet.addModule(WORKLET_URL);
      const source = captureCtx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(captureCtx, "pcm16-capture");
      nodeRef.current = node;
      const sink = captureCtx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(captureCtx.destination);

      const playCtx = new AudioContext({ sampleRate: PLAYBACK_RATE });
      playCtxRef.current = playCtx;

      const { GoogleGenAI, Modality } = await import("@google/genai");
      const ai = new GoogleGenAI({
        apiKey: token.token,
        httpOptions: { apiVersion: "v1alpha" },
      });

      const session = await ai.live.connect({
        model: token.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => setState("live"),
          onmessage: (m) => onMessage(m as LiveMessage),
          onerror: (e) => {
            setError(e.message || CONNECT_FAILED);
            setState("failed");
            void endRef.current();
          },
          onclose: () => {
            void endRef.current();
          },
        },
      });
      sessionRef.current = session;
      setState("live");
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "Please begin the interview." }] }],
        turnComplete: true,
      });

      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const raw = e.data;
        let sum = 0;
        for (let i = 0; i < raw.length; i++) sum += raw[i]! * raw[i]!;
        setLevel(raw.length ? Math.sqrt(sum / raw.length) : 0);

        const frame =
          captureCtx.sampleRate === CAPTURE_RATE
            ? raw
            : resampleLinear(raw, captureCtx.sampleRate, CAPTURE_RATE);
        try {
          sessionRef.current?.sendRealtimeInput({
            audio: {
              data: int16ToBase64(floatTo16BitPCM(frame)),
              mimeType: `audio/pcm;rate=${CAPTURE_RATE}`,
            },
          });
        } catch (err) {
          console.warn("[live] dropped a frame:", err);
        }
      };

      const startedAt = Date.now();
      tickTimer.current = setInterval(() => {
        const seconds = Math.round((Date.now() - startedAt) / 1_000);
        setElapsedS(seconds);
        if (seconds >= maxMinutes * 60) void endRef.current();
      }, 1_000);
    } catch (err) {
      console.warn("[live] could not open the session:", err);
      teardown();
      endedRef.current = true;
      startedRef.current = false;
      setError(reason(err));
      setState("failed");
    }
  }, [sessionId, maxMinutes, onMessage, teardown]);

  useEffect(() => {
    return () => {
      endedRef.current = true;
      teardown();
    };
  }, [teardown]);

  return {
    state,
    error,
    modelSpeaking,
    userSpeaking,
    elapsedS,
    log,
    liveQuestion,
    liveAnswer,
    level,
    start,
    end,
  };
}
