"use client";

// DEV-ONLY voice tester (spec §7). Open on each device you care about, click
// through the voices, then reorder PRIORITY in hooks/useSpeech.ts to match what
// actually sounds good. DELETE THIS ROUTE BEFORE SHIPPING.

import { useEffect, useState } from "react";

const SAMPLE = "You mentioned a queue earlier — why reach for that over a direct call?";

export default function VoiceTester() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  function play(v: SpeechSynthesisVoice) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(SAMPLE);
    u.voice = v;
    u.lang = v.lang;
    window.speechSynthesis.speak(u);
  }

  if (!supported) return <main className="p-8">No speechSynthesis on this browser.</main>;

  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const other = voices.filter((v) => !v.lang?.toLowerCase().startsWith("en"));

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-display text-3xl">Voices on this device ({voices.length})</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Dev-only. Tune <code className="font-mono">PRIORITY</code> in{" "}
        <code className="font-mono">hooks/useSpeech.ts</code>, then delete this route.
      </p>

      <Group title={`English (${english.length})`} voices={english} onPlay={play} />
      <Group title={`Other (${other.length})`} voices={other} onPlay={play} />
    </main>
  );
}

function Group({
  title,
  voices,
  onPlay,
}: {
  title: string;
  voices: SpeechSynthesisVoice[];
  onPlay: (v: SpeechSynthesisVoice) => void;
}) {
  if (!voices.length) return null;
  return (
    <section className="mt-8">
      <p className="font-mono text-[11px] tracking-[0.16em] text-ink-muted uppercase">{title}</p>
      <ul className="rounded-card mt-3 divide-y divide-line border border-line bg-paper-raised">
        {voices.map((v) => (
          <li key={v.voiceURI} className="flex items-center gap-3 px-4 py-2.5">
            <button
              onClick={() => onPlay(v)}
              className="rounded-full bg-ember px-3 py-1 text-xs font-medium text-paper"
            >
              play
            </button>
            <span className="font-mono text-xs">
              {v.name} — {v.lang}
              {v.localService ? "" : " (online)"}
              {v.default ? " (default)" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
