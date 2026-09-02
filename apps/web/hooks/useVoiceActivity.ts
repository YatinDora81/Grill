"use client";

import { useEffect, useRef, useState } from "react";
import type { MicVAD } from "@ricky0123/vad-web";

export type VadState = "off" | "loading" | "listening" | "failed";

export interface VoiceActivity {
  state: VadState;
  speaking: boolean;
  spoke: boolean;
  silenceMs: number;
  spokenMs: number;
  firstSpeechAt: number | null;
}

const TICK_MS = 200;
const ASSET_PATH = "/vad/";

const IDLE: VoiceActivity = {
  state: "off",
  speaking: false,
  spoke: false,
  silenceMs: 0,
  spokenMs: 0,
  firstSpeechAt: null,
};

export function useVoiceActivity(stream: MediaStream | null, enabled: boolean): VoiceActivity {
  const [activity, setActivity] = useState<VoiceActivity>(IDLE);
  const vadRef = useRef<MicVAD | null>(null);
  const speakingRef = useRef(false);
  const segmentStartRef = useRef<number | null>(null);
  const lastEndRef = useRef<number | null>(null);
  const spokenRef = useRef(0);
  const firstRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream || !enabled) {
      setActivity(IDLE);
      return;
    }
    let cancelled = false;
    let vad: MicVAD | null = null;
    speakingRef.current = false;
    segmentStartRef.current = null;
    lastEndRef.current = null;
    spokenRef.current = 0;
    firstRef.current = null;
    setActivity({ ...IDLE, state: "loading" });

    void (async () => {
      try {
        const { MicVAD } = await import("@ricky0123/vad-web");
        if (cancelled) return;
        vad = await MicVAD.new({
          model: "v5",
          baseAssetPath: ASSET_PATH,
          onnxWASMBasePath: ASSET_PATH,
          getStream: async () => stream,
          pauseStream: async () => {},
          resumeStream: async () => stream,
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          redemptionMs: 600,
          preSpeechPadMs: 300,
          minSpeechMs: 250,
          submitUserSpeechOnPause: false,
          onSpeechRealStart: () => {
            const now = performance.now();
            speakingRef.current = true;
            segmentStartRef.current = now;
            if (firstRef.current === null) firstRef.current = now;
          },
          onSpeechEnd: () => {
            const now = performance.now();
            if (segmentStartRef.current !== null)
              spokenRef.current += now - segmentStartRef.current;
            segmentStartRef.current = null;
            speakingRef.current = false;
            lastEndRef.current = now;
          },
          onVADMisfire: () => {
            segmentStartRef.current = null;
            speakingRef.current = false;
          },
        });
        if (cancelled) {
          await vad.destroy();
          return;
        }
        vadRef.current = vad;
        await vad.start();
        if (!cancelled) setActivity({ ...IDLE, state: "listening" });
      } catch (err) {
        console.warn("[vad] unavailable; hands-free off for this take:", err);
        if (!cancelled) setActivity({ ...IDLE, state: "failed" });
      }
    })();

    const tick = setInterval(() => {
      if (cancelled || !vadRef.current) return;
      const now = performance.now();
      const speaking = speakingRef.current;
      const live = segmentStartRef.current !== null ? now - segmentStartRef.current : 0;
      setActivity({
        state: "listening",
        speaking,
        spoke: firstRef.current !== null,
        silenceMs: speaking || lastEndRef.current === null ? 0 : now - lastEndRef.current,
        spokenMs: spokenRef.current + live,
        firstSpeechAt: firstRef.current,
      });
    }, TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(tick);
      const v = vadRef.current ?? vad;
      vadRef.current = null;
      if (v) void v.destroy().catch(() => {});
    };
  }, [stream, enabled]);

  return activity;
}
