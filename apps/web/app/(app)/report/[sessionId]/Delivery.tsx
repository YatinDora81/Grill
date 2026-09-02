import type { DeliveryMetrics } from "@repo/types";
import { Explain } from "@/components/Explain";
import { cx } from "@/components/ui";

export const COMPOSED = { lo: 110, hi: 160 } as const;
const SCALE = { lo: 80, hi: 200 } as const;

const pct = (wpm: number) => ((wpm - SCALE.lo) / (SCALE.hi - SCALE.lo)) * 100;
const clamp = (v: number) => Math.max(0, Math.min(100, v));

export type DeliverySubject = "you" | "them";

const VOICE = {
  you: { they: "you", their: "your", tick: "you" },
  them: { they: "they", their: "their", tick: "them" },
} as const;

type Voice = (typeof VOICE)[DeliverySubject];

export function Delivery({
  metrics: m,
  subject = "you",
}: {
  metrics: DeliveryMetrics;
  subject?: DeliverySubject;
}) {
  const acousticsMissing =
    m.pitch_variation === null && m.energy === null && m.mean_pitch_hz === null;
  const cameraMissing = m.camera_turns === 0;
  const note = paceNote(m.wpm);
  const v = VOICE[subject];

  return (
    <div className="mt-4 border-t border-l border-line">
      <div className="grid grid-cols-2 md:grid-cols-3">
        <Metric
          label="Pace"
          value={m.wpm ? String(Math.round(m.wpm)) : "—"}
          unit="wpm"
          note={paceExplain(m.wpm, v)}
        >
          {note ? (
            <span
              className={cx(
                "mt-2 block font-mono text-[0.58rem] tracking-[0.1em] uppercase",
                note.tone === "strong" ? "tone-strong" : "tone-mixed",
              )}
            >
              {note.text}
            </span>
          ) : null}
        </Metric>
        <Metric
          label="Avg pause"
          value={m.avg_pause_ms ? String(Math.round(m.avg_pause_ms)) : "—"}
          unit="ms"
          note={pauseExplain(m.avg_pause_ms, v)}
        />
        <Metric
          label="Fillers"
          value={String(m.filler_count)}
          unit="total"
          note={fillerExplain(m.filler_count)}
        />
        <Metric
          label="Pitch variation"
          value={m.pitch_variation !== null ? m.pitch_variation.toFixed(1) : "—"}
          unit="Hz"
          note={
            m.pitch_variation !== null
              ? `How much ${v.their} voice moves while ${v.they} talk. The bigger the number, the less flat ${v.they} sound.`
              : null
          }
        />
        <Metric
          label="Energy"
          value={m.energy !== null ? m.energy.toFixed(3) : "—"}
          unit="rms"
          note={
            m.energy !== null
              ? `How loudly ${v.they} spoke, straight off the waveform. It's a relative level, not decibels — compare it against ${v.their} own other runs.`
              : null
          }
        />
        <Metric
          label="Mean pitch"
          value={m.mean_pitch_hz !== null ? String(Math.round(m.mean_pitch_hz)) : "—"}
          unit="Hz"
          note={
            m.mean_pitch_hz !== null
              ? `The average pitch of ${v.their} voice. It says nothing about how ${v.they} did — it's the baseline the variation is measured against.`
              : null
          }
        />

        <Metric
          label="Steadiness"
          value={m.jitter_local !== null ? (m.jitter_local * 100).toFixed(2) : "—"}
          unit="% jitter"
          note={
            m.jitter_local !== null
              ? `Cycle-to-cycle wobble in pitch, measured off the waveform. Steady speaking voices sit around 1% or below; higher reads as a less steady voice — not a nervous one. It's a rough guide, so the useful comparison is against ${v.their} own other runs.`
              : null
          }
        >
          {m.shimmer_local !== null ? (
            <span className="mt-2 block font-mono text-[0.58rem] tracking-[0.1em] uppercase text-ink-muted">
              {(m.shimmer_local * 100).toFixed(2)}% shimmer
            </span>
          ) : null}
        </Metric>
        <Metric
          label="Voice clarity"
          value={m.hnr_db !== null ? m.hnr_db.toFixed(1) : "—"}
          unit="dB"
          note={
            m.hnr_db !== null
              ? "Harmonics-to-noise ratio: how much of the sound is clean tone versus breath and rasp. Higher is clearer, and roughly 20 dB and up is a clear speaking voice. A poor microphone drags it down too, so read it beside the recording."
              : null
          }
        />
        <Metric
          label="Uptalk"
          value={m.uptalk_pct !== null ? `${m.uptalk_rising}/${m.uptalk_statements}` : "—"}
          unit="rose"
          note={
            m.uptalk_pct !== null
              ? `Statements that ended on a rising pitch, the way a question does. A few is ordinary speech; a lot of them makes claims sound like they are asking for agreement. Questions ${v.they} actually asked are not counted.`
              : null
          }
        />

        <Metric
          label="Articulation"
          value={m.articulation_rate_sps !== null ? m.articulation_rate_sps.toFixed(2) : "—"}
          unit="syll/s"
          note={
            m.articulation_rate_sps !== null
              ? `Syllables a second across the time ${v.they} were actually voicing, counted off the intensity contour rather than the words. Pauses are excluded, so this is the speed of the speech itself${m.speech_rate_sps !== null ? `, against ${m.speech_rate_sps.toFixed(2)} once the pauses are counted back in` : ""}.`
              : null
          }
        />
        <Metric
          label="Phonation"
          value={m.phonation_ratio !== null ? String(Math.round(m.phonation_ratio * 100)) : "—"}
          unit="%"
          note={
            m.phonation_ratio !== null
              ? `The share of the recording ${v.they} were making sound in. The rest is breath and silence — some of it is thinking, some of it is the room.`
              : null
          }
        />
        <Metric
          label="Trailing off"
          value={
            m.trailing_off_pct !== null
              ? `${m.trailing_off_fading}/${m.trailing_off_statements}`
              : "—"
          }
          unit="faded"
          note={
            m.trailing_off_pct !== null
              ? `Statements whose last third of a second dropped at least 6 dB below the rest of the sentence. A few is ordinary; a lot means the end of ${v.their} point is the part the interviewer has to strain for.`
              : null
          }
        />
        <Metric
          label="Transcriber confidence"
          value={m.transcriber_confidence !== null ? m.transcriber_confidence.toFixed(2) : "—"}
          unit="log prob"
          note={
            m.transcriber_confidence !== null
              ? "How sure the transcriber was of the words it wrote down, averaged over the recording. It is always negative and closer to zero is clearer — a low number is usually a mumbled or distant mic, not a wrong answer."
              : null
          }
        />

        <Metric
          label="Looked at camera"
          value={m.on_camera_pct !== null ? String(Math.round(m.on_camera_pct)) : "—"}
          unit="%"
          note={
            m.on_camera_pct !== null
              ? `How much of ${v.their} speaking time ${v.their} eyes and head were pointed at the lens. Measured on ${v.their} own device — no video was uploaded to work it out. An interviewer on a video call reads this as attention, but it is a camera, not a person: notes off to the side are a perfectly good reason to be looking away.`
              : null
          }
        />
        <Metric
          label="Smiled"
          value={m.smile_pct !== null ? String(Math.round(m.smile_pct)) : "—"}
          unit="%"
          note={
            m.smile_pct !== null
              ? "Share of the time a smile was visible on camera. There is no right number here and it moves no score — but a flat zero across a whole interview is worth knowing about."
              : null
          }
        />
        <Metric
          label="Head movement"
          value={m.head_motion_dps !== null ? m.head_motion_dps.toFixed(1) : "—"}
          unit="°/s"
          note={
            m.head_motion_dps !== null
              ? `How fast ${v.their} head turned while ${v.they} talked, in degrees a second. Very low reads as stiff and very high reads as restless, with a wide ordinary middle — compare it against ${v.their} own other runs rather than against anyone else's.`
              : null
          }
        />

        <Metric
          label="Slouched"
          value={m.slouch_pct !== null ? String(Math.round(m.slouch_pct)) : "—"}
          unit="%"
          note={
            m.slouch_pct !== null
              ? `How much of the time ${v.their} head sat lower over ${v.their} shoulders than it did in the calibration pose. It is measured against ${v.their} own neutral, so it says nothing about posture in general.`
              : null
          }
        />
        <Metric
          label="Hands near face"
          value={m.hands_to_face_pct !== null ? String(Math.round(m.hands_to_face_pct)) : "—"}
          unit="%"
          note={
            m.hands_to_face_pct !== null
              ? `Share of the frames a hand was within a shoulder-width of ${v.their} face. On a video call it covers the mouth and the audio with it; the number moves no score.`
              : null
          }
        />
        <Metric
          label="Shoulder tilt"
          value={m.shoulder_tilt_deg !== null ? m.shoulder_tilt_deg.toFixed(1) : "—"}
          unit="°"
          note={
            m.shoulder_tilt_deg !== null
              ? "Average angle of the shoulder line off horizontal. A steady few degrees is a chair or a camera on a slant, not a verdict."
              : null
          }
        />
        <Metric
          label="Wrist motion"
          value={m.wrist_motion !== null ? m.wrist_motion.toFixed(2) : "—"}
          unit="sw/s"
          note={
            m.wrist_motion !== null
              ? `How far ${v.their} wrists travelled a second, in shoulder-widths, so the number holds whether ${v.they} sat close to the lens or far from it. Compare it against ${v.their} own other runs.`
              : null
          }
        />

        <Metric
          label="Time to first word"
          value={
            m.response_latency_ms !== null
              ? String(Math.round(m.response_latency_ms / 100) / 10)
              : "—"
          }
          unit="s"
          note={
            m.response_latency_ms !== null
              ? `How long ${v.they} took to start talking after the question ended, median across answers. Under about a second reads as ready; several seconds is thinking time, which is fine if the answer is worth it.`
              : null
          }
        />
      </div>

      <div className="border-r border-b border-line p-5 sm:p-6">
        <PaceBand wpm={m.wpm} voice={v} />

        {acousticsMissing ? (
          <p className="mono-note" style={{ marginTop: 16 }}>
            Tone wasn&apos;t measured for this session — either the answers were typed, or the audio
            service wasn&apos;t reachable.
          </p>
        ) : null}

        {cameraMissing ? (
          <p className="mono-note" style={{ marginTop: 12 }}>
            The camera was off or blocked for this session, so there is nothing on-camera to
            measure.
          </p>
        ) : null}

        {m.interruptions > 0 ? (
          <p className="mono-note" style={{ marginTop: 12 }}>
            The interviewer cut in {m.interruptions} time(s) — answers were running long.
          </p>
        ) : null}

        <p className="dfoot">
          <b>pace &amp; pauses</b> ← word-level timings&ensp;·&ensp;<b>pitch, energy &amp; voice</b>{" "}
          ← raw audio&ensp;·&ensp;<b>on camera</b> ← the webcam, in {v.their} own
          browser&ensp;·&ensp;<b>syllables &amp; fading</b> ← intensity
          contour&ensp;·&ensp;<b>posture</b> ← body landmarks, on device&ensp;·&ensp;never the
          transcript
        </p>
      </div>
    </div>
  );
}

function PaceBand({ wpm, voice }: { wpm: number; voice: Voice }) {
  const zoneLeft = pct(COMPOSED.lo);
  const zoneWidth = pct(COMPOSED.hi) - zoneLeft;

  return (
    <div>
      <p className="dk">Where {voice.their} pace sits</p>
      <div className="band-scale">
        <div className="band-zone" style={{ left: `${zoneLeft}%`, width: `${zoneWidth}%` }}>
          <span className="band-zone-label">
            composed band · {COMPOSED.lo}–{COMPOSED.hi}
          </span>
        </div>
        {wpm ? (
          <div className="band-tick" style={{ left: `${clamp(pct(wpm))}%` }}>
            <span className="band-tick-label">
              {voice.tick} · {Math.round(wpm)}
            </span>
          </div>
        ) : null}
      </div>
      <div className="band-ends">
        <span>{SCALE.lo} · slow</span>
        <span>{SCALE.hi} · rushed</span>
      </div>
      <Explain>
        The whole bar is words a minute, from {SCALE.lo} to {SCALE.hi}. The lit strip is the stretch
        interviewers hear as composed{wpm ? `, and the tick is ${voice.tick}` : ""}.
      </Explain>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  children,
  note,
}: {
  label: string;
  value: string;
  unit: string;
  children?: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="border-r border-b border-line p-5 sm:p-6">
      <p className="font-mono text-[0.56rem] tracking-[0.18em] uppercase text-ink-muted">{label}</p>
      <p className="mt-2 font-mono text-[1.35rem] leading-none font-semibold tabular">
        {value}
        <small className="ml-1 text-[0.5em] font-normal text-ink-muted">{unit}</small>
      </p>
      {note ? <Explain>{note}</Explain> : null}
      {children}
    </div>
  );
}

export function paceNote(wpm: number): { text: string; tone: "strong" | "mixed" } | null {
  if (!wpm) return null;
  if (wpm > 175) return { text: "Rushed", tone: "mixed" };
  if (wpm < 105) return { text: "Slow", tone: "mixed" };
  return { text: "composed", tone: "strong" };
}

function paceExplain(wpm: number, voice: Voice): string | null {
  if (!wpm) return null;
  return `How fast ${voice.they} spoke. ${COMPOSED.lo}–${COMPOSED.hi} words a minute is the stretch an interviewer hears as composed: slower and ${voice.they} sound unsure of the answer, faster and the interviewer stops following it.`;
}

function pauseExplain(ms: number, voice: Voice): string | null {
  if (!ms) return null;
  return `The average gap between ${voice.their} words. Short gaps read as fluent, long ones read as hesitation — a pause is only a problem when it lands mid-sentence.`;
}

function fillerExplain(count: number): string {
  if (count === 0) return "Not one um, uh or like in the whole interview.";
  return "Every um, uh and like, counted across the whole interview. A handful is normal speech; a pile of them is what people mean when they say someone sounded nervous.";
}
