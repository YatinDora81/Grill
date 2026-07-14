"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const VOICE_KEY = "grill.voice";
const MUTED_KEY = "grill.muted";

/**
 * Best-sounding first; the user's explicit choice always overrides this.
 * These names are a starting point only — the exact set depends on the OS and
 * browser, so it needs checking against real devices via /voices.
 */
const PRIORITY = [
  // Apple (macOS/iOS)
  "Ava (Enhanced)",
  "Samantha",
  "Ava",
  "Allison",
  "Susan",
  "Zoe",
  "Tom",
  "Daniel",
  "Karen",
  // Windows / Edge
  "Microsoft Aria Online (Natural)",
  "Microsoft Aria",
  "Microsoft Jenny",
  "Microsoft Guy",
  // Android
  "Google US English",
];

function isSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function choose(
  voices: SpeechSynthesisVoice[],
  voiceURI: string | null,
): SpeechSynthesisVoice | undefined {
  if (!voices.length) return undefined;
  if (voiceURI) {
    const chosen = voices.find((v) => v.voiceURI === voiceURI);
    if (chosen) return chosen;
  }
  for (const name of PRIORITY) {
    const v = voices.find((x) => x.name === name);
    if (v) return v;
  }
  return (
    voices.find((v) => v.lang === "en-US" && v.localService) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ||
    voices[0]
  );
}

export function useSpeech() {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);

  /**
   * Refs mirror the state that speak() reads. speak() has to stay
   * referentially stable — the hot seat uses it as an effect dependency, so a
   * new identity on every voice-list update or mute toggle would restart the
   * question mid-sentence. Refs also settle synchronously, which matters on
   * mount: the stored mute preference lands before the first speak() call,
   * so a muted user doesn't hear question one.
   */
  const mutedRef = useRef(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const voiceURIRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSupported()) return;
    setSupported(true);

    const synth = window.speechSynthesis;

    // getVoices() is empty on the first call in most browsers — the list
    // arrives later on `voiceschanged`, so we have to read it in both places.
    const load = () => {
      const v = synth.getVoices();
      if (v.length) {
        voicesRef.current = v;
        setVoices(v);
      }
    };
    load();
    synth.addEventListener("voiceschanged", load);

    const storedMuted = localStorage.getItem(MUTED_KEY) === "1";
    mutedRef.current = storedMuted;
    setMuted(storedMuted);

    const storedVoice = localStorage.getItem(VOICE_KEY);
    voiceURIRef.current = storedVoice;
    setVoiceURI(storedVoice);

    return () => {
      synth.removeEventListener("voiceschanged", load);
      synth.cancel();
    };
  }, []);

  const speak = useCallback((text: string) => {
    if (!isSupported() || mutedRef.current || !text.trim()) return;
    const synth = window.speechSynthesis;
    // Utterances queue rather than replace — without this they stack up and
    // the interviewer talks over itself.
    synth.cancel();

    const u = new SpeechSynthesisUtterance(text);
    const v = choose(voicesRef.current, voiceURIRef.current);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.rate = 1;
    u.pitch = 1;
    u.volume = 1;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.speak(u);
  }, []);

  const stop = useCallback(() => {
    if (isSupported()) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    try {
      localStorage.setItem(MUTED_KEY, next ? "1" : "0");
    } catch {
      // Private mode / disabled storage: the toggle still works this session.
    }
    if (next && isSupported()) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }, []);

  const selectVoice = useCallback((uri: string) => {
    const next = uri || null;
    voiceURIRef.current = next;
    setVoiceURI(next);
    try {
      if (next) localStorage.setItem(VOICE_KEY, next);
      else localStorage.removeItem(VOICE_KEY);
    } catch {
      /* see above */
    }
  }, []);

  const englishVoices = useMemo(
    () => voices.filter((v) => v.lang?.toLowerCase().startsWith("en")),
    [voices],
  );
  const currentVoice = useMemo(() => choose(voices, voiceURI), [voices, voiceURI]);

  return {
    supported,
    speaking,
    muted,
    voices,
    englishVoices,
    voiceURI,
    currentVoice,
    speak,
    stop,
    toggleMute,
    selectVoice,
  };
}
