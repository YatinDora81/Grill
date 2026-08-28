"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { findFillerWords } from "@/lib/fillers";
import { rollingWpm, splitWords, trimSamples, type WordSample } from "@/lib/live/rolling";

export const MAX_RESTARTS = 20;

const TICK_MS = 1_000;

interface LiveRecognitionAlternative {
  readonly transcript: string;
}

interface LiveRecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: LiveRecognitionAlternative | undefined;
}

interface LiveRecognitionResultList {
  readonly length: number;
  readonly [index: number]: LiveRecognitionResult | undefined;
}

interface LiveRecognitionEvent {
  readonly results: LiveRecognitionResultList;
}

interface LiveRecognitionErrorEvent {
  readonly error: string;
}

interface LiveRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: LiveRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: LiveRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type LiveRecognitionCtor = new () => LiveRecognition;

interface RecognitionWindow {
  SpeechRecognition?: LiveRecognitionCtor;
  webkitSpeechRecognition?: LiveRecognitionCtor;
}

function recognitionCtor(): LiveRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as RecognitionWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed"]);

export interface LiveTranscript {
  supported: boolean;
  words: number;
  fillers: number;
  rollingWpm: number | null;
  restartCount: number;
}

export function useLiveTranscript(active: boolean, lang?: string): LiveTranscript {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(recognitionCtor() !== null);
  }, []);

  const [text, setText] = useState("");
  const [wpm, setWpm] = useState<number | null>(null);
  const [restartCount, setRestartCount] = useState(0);

  const carryRef = useRef("");
  const sessionFinalRef = useRef("");
  const samplesRef = useRef<WordSample[]>([]);
  const restartsRef = useRef(0);

  useEffect(() => {
    if (!supported || !active) {
      carryRef.current = "";
      sessionFinalRef.current = "";
      samplesRef.current = [];
      restartsRef.current = 0;
      setText("");
      setWpm(null);
      setRestartCount(0);
      return;
    }

    const Ctor = recognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    const navigatorLang = typeof navigator !== "undefined" ? navigator.language : undefined;
    recognition.lang = lang ?? (navigatorLang?.startsWith("en-") ? navigatorLang : "en-US");

    let stopped = false;

    recognition.onresult = (event) => {
      const finals: string[] = [];
      const interim: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const alternative = result?.[0];
        if (!result || !alternative) continue;
        (result.isFinal ? finals : interim).push(alternative.transcript);
      }

      sessionFinalRef.current = finals.join(" ").trim();
      const live = [carryRef.current, sessionFinalRef.current, interim.join(" ")]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      setText(live);

      const now = performance.now();
      samplesRef.current = trimSamples(
        [...samplesRef.current, { t: now, words: splitWords(live).length }],
        now,
      );
    };

    recognition.onend = () => {
      if (stopped) return;
      carryRef.current = [carryRef.current, sessionFinalRef.current].join(" ").trim();
      sessionFinalRef.current = "";

      if (restartsRef.current >= MAX_RESTARTS) {
        stopped = true;
        console.warn("[useLiveTranscript] recognition restarted too often; leaving the HUD frozen");
        return;
      }
      restartsRef.current += 1;
      setRestartCount(restartsRef.current);
      try {
        recognition.start();
      } catch {}
    };

    recognition.onerror = (event) => {
      if (FATAL_ERRORS.has(event.error)) stopped = true;
    };

    try {
      recognition.start();
    } catch {}

    const tick = setInterval(() => {
      setWpm(rollingWpm(samplesRef.current, performance.now()));
    }, TICK_MS);

    return () => {
      stopped = true;
      clearInterval(tick);
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try {
        recognition.stop();
      } catch {}
      try {
        recognition.abort();
      } catch {}
    };
  }, [supported, active, lang]);

  const wordList = useMemo(() => splitWords(text), [text]);
  const fillers = useMemo(() => findFillerWords(wordList).occurrences, [wordList]);

  return { supported, words: wordList.length, fillers, rollingWpm: wpm, restartCount };
}
