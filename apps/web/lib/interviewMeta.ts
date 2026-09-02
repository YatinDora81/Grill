import type {
  Difficulty,
  ExclusiveMode,
  InterviewConfig,
  InterviewSource,
  Persona,
  QuestionSetSource,
} from "@repo/types";

export const QUESTION_BOUNDS = { min: 3, max: 100 } as const;

export const QUESTION_SET_BOUNDS = { min: 1, max: 30 } as const;

export function drillTurnBudget(starredCount: number): number {
  return Math.min(starredCount * 2, QUESTION_BOUNDS.max);
}

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard", "extreme"] as const;

export function coerceDifficulty(d: string): Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(d) ? (d as Difficulty) : "medium";
}

export const ANSWER_CAP_MODEL = {
  buildBudgetS: 300,
  llmFixedS: 60,
  clipFixedS: 2,
  clipPerSecond: 0.15,
  concurrency: 5,
  answerCeilingS: 240,
  answerFloorS: 60,
} as const;

export function perAnswerCapSeconds(numQuestions: number): number | null {
  const m = ANSWER_CAP_MODEL;
  const k = 1 / m.concurrency;
  const buildTerm =
    ((m.buildBudgetS - m.llmFixedS) / (k * numQuestions) - m.clipFixedS) / m.clipPerSecond;
  const cap = Math.min(m.answerCeilingS, buildTerm);
  if (cap < m.answerFloorS) return null;
  return Math.floor(cap / 30) * 30;
}

export interface DifficultyMeta {
  label: string;
  color: string;
  blurb: string;
  pitch: string;
}

export const DIFFICULTY_META: Record<Difficulty, DifficultyMeta> = {
  easy: {
    label: "Easy",
    color: "var(--color-strong)",
    blurb: "Fundamentals and clear explanations. Warm-up pace.",
    pitch: "Keep questions approachable — core concepts, straightforward scenarios, room to think out loud.",
  },
  medium: {
    label: "Medium",
    color: "color-mix(in srgb, var(--color-strong) 45%, var(--color-mixed))",
    blurb: "You own features end to end and can defend the how.",
    pitch: "Solid working-level depth — real decisions, trade-offs, and concrete examples from practice.",
  },
  hard: {
    label: "Hard",
    color: "var(--color-mixed)",
    blurb: "Trade-offs, failure, and the calls you got wrong.",
    pitch: "Push hard on judgement, failure modes, and ambiguity — answers need sharp reasoning, not slogans.",
  },
  extreme: {
    label: "Extreme",
    color: "var(--color-weak)",
    blurb: "Systems, blast radius, and answering for outcomes under pressure.",
    pitch: "Brutal but fair — staff/principal depth, uncomfortable edge cases, and no soft landings.",
  },
};

export function difficultyLabel(d: Difficulty): string {
  return DIFFICULTY_META[d].label;
}

export interface PersonaMeta {
  label: string;
  tagline: string;
  prompt: string;
}

export const PERSONA_META: Record<Persona, PersonaMeta> = {
  neutral: { label: "Neutral", tagline: "Sharp, fair, no theater.", prompt: "" },
  friendly_screen: {
    label: "Friendly screen",
    tagline: "Warm HR opener energy.",
    prompt:
      "Voice: warm and encouraging, first-round phone-screen register. Soften phrasing, never the substance — probe just as deep.",
  },
  terse_staff: {
    label: "Terse staff eng",
    tagline: "Five words where five suffice.",
    prompt:
      "Voice: minimal, dry, zero pleasantries. Questions are short and surgical. No filler, no praise.",
  },
  bar_raiser: {
    label: "Bar-raiser",
    tagline: "Evidence or it didn't happen.",
    prompt:
      "Voice: structured behavioral rigor. Push for specifics, ownership and measurable outcomes; ask for the data behind every claim.",
  },
  skeptic: {
    label: "The skeptic",
    tagline: "Assumes it broke in prod.",
    prompt:
      "Voice: politely unconvinced. Challenge premises and tradeoffs; ask what failed, what they'd undo, and why the alternative wasn't better. Professional, never insulting.",
  },
};

export const PERSONAS: readonly Persona[] = [
  "neutral",
  "friendly_screen",
  "terse_staff",
  "bar_raiser",
  "skeptic",
] as const;

export const PERSONA_VOICE: Record<Persona, { voice: string; direction: string }> = {
  neutral: { voice: "hannah", direction: "" },
  friendly_screen: { voice: "autumn", direction: "[cheerful] " },
  terse_staff: { voice: "troy", direction: "" },
  bar_raiser: { voice: "daniel", direction: "" },
  skeptic: { voice: "austin", direction: "" },
};

export const PERSONA_KOKORO_VOICE: Record<Persona, string> = {
  neutral: "af_heart",
  friendly_screen: "af_bella",
  terse_staff: "am_michael",
  bar_raiser: "bm_daniel",
  skeptic: "am_fenrir",
};

export const PERSONA_GEMINI_VOICE: Record<Persona, string> = {
  neutral: "Kore",
  friendly_screen: "Aoede",
  terse_staff: "Charon",
  bar_raiser: "Orus",
  skeptic: "Fenrir",
};

export const PERSONA_GUARDRAIL =
  "Persona changes tone and phrasing only — question difficulty, topic selection, and follow-up logic are unchanged; remain professional.";

export function personaLabel(p: Persona | null | undefined): string {
  return PERSONA_META[p ?? "neutral"].label;
}

export function personaBrief(p: Persona | null | undefined): string {
  const { prompt } = PERSONA_META[p ?? "neutral"];
  return prompt ? `${prompt}\n${PERSONA_GUARDRAIL}` : "";
}

export const SOURCE_META: Record<InterviewSource, { label: string; blurb: string }> = {
  resume: { label: "Résumé", blurb: "Your own history — what you built, and what you'd rather skip." },
  topic: { label: "Topic", blurb: "A subject you name, tied back to work you've actually done." },
  cultural: {
    label: "Cultural",
    blurb: "How you work with people: conflict, feedback, judgement. Combines with Résumé when both are on.",
  },
};

export const MODE_META: Record<ExclusiveMode, { label: string; blurb: string }> = {
  jd: {
    label: "Job description",
    blurb: "Interviews you for a real posting, and probes the gaps against your résumé.",
  },
  real: {
    label: "Real interview",
    blurb: "The full arc: introduce yourself, your history, concepts, the hard part, then your questions for us.",
  },
  topic_only: {
    label: "Topic only",
    blurb: "Pure subject examination. Your résumé is ignored entirely.",
  },
  cultural_only: {
    label: "Cultural only",
    blurb: "Culture-fit screen: work style, values, conflict, feedback. Your résumé is ignored.",
  },
  weak_spots: {
    label: "Weak spots",
    blurb: "Re-asks the questions you scored worst on in past interviews, plus new ground.",
  },
  starred: {
    label: "Starred drill",
    blurb: "Your saved killers, asked back in order.",
  },
  project: {
    label: "Project",
    blurb:
      "Defend something you built — architecture, trade-offs, what breaks first. Paste a write-up or import a GitHub repo.",
  },
};

export function interviewLabel(c: InterviewConfig): string {
  if (c.mode === "jd" && c.company?.trim()) {
    return `${MODE_META.jd.label} · ${c.company.trim()}`;
  }
  if (c.mode) return MODE_META[c.mode].label;
  return c.sources.map((s) => SOURCE_META[s].label).join(" + ");
}

export const UNTITLED = "Untitled interview";

const RETRY_SUFFIX = /\s*\(retry(?:\s+(\d+))?\)$/i;

const NAME_MAX = 80;

export function retryName(parentName: string | null): string {
  const parent = parentName?.trim() || UNTITLED;
  const prior = RETRY_SUFFIX.exec(parent);
  const base = prior ? parent.slice(0, prior.index) : parent;
  const next = prior ? Number(prior[1] ?? 1) + 1 : 1;

  const suffix = next === 1 ? " (retry)" : ` (retry ${next})`;
  return base.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
}

export const SET_SOURCE_META: Record<
  QuestionSetSource,
  { label: string; blurb: string }
> = {
  resume: {
    label: "Résumé",
    blurb: "Grounded in your own history — the questions your CV invites.",
  },
  topic: {
    label: "Topic",
    blurb: "A pure drill on a subject you name. No résumé involved.",
  },
  cultural: {
    label: "Cultural",
    blurb: "Working style, conflict, feedback, values. No material needed.",
  },
};

export function setInterviewName(setName: string | null, takeNumber: number): string {
  const base = setName?.trim() || "Question set";
  const suffix = takeNumber <= 1 ? " — interview" : ` — take ${takeNumber}`;
  return base.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
}
