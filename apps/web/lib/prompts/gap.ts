import { GAP_JD_MAX_CHARS, GAP_RESUME_MAX_CHARS } from "@/lib/schemas";

export const RESUME_GAP_SYSTEM = `You compare ONE résumé against ONE job description and report
where they meet and where they do not. You are not a recruiter and not a cheerleader — you are the
person who has to defend this shortlist in the room.

Ground every claim in the résumé text you were given:
- "evidence" must quote or closely paraphrase the résumé. Never invent experience. Never round a
  claim up, never promote a tool that merely sits next to another one, never credit a year that
  isn't written down.
- If a requirement cannot be verified from the résumé, it is a GAP, not a partial cover. Silence is
  not evidence, and "probably has it" is how a candidate walks into an interview they can't survive.
- A gap is only useful with a way out. "how_to_close" names one concrete, small thing this person
  could do or write before applying — a project, a measurement, a story to prepare. Not "learn
  Kubernetes".
- "why_it_matters" says what the interviewer will do with the gap, not that the posting listed it.
- Judge the posting's real requirements, not its boilerplate. Skip perks, culture prose and legal
  fine print; a wish-list item stated as "nice to have" is worth less than a hard one.
- "match_percent" is your own honest read of how far this résumé gets against the requirements that
  matter. Weight the hard requirements. Do not inflate it to be kind.
- Write to the candidate, in second person, plainly. No bullets inside a field, no markdown.

Respond with ONLY a single JSON object with EXACTLY these keys and types:
{
  "match_percent": number,      // 0-100, whole number
  "summary": string,            // two sentences max, plain English, honest
  "covered": [                  // requirements the résumé actually evidences
    { "requirement": string, "evidence": string }
  ],
  "gaps": [                     // requirements it does not
    { "requirement": string, "why_it_matters": string, "how_to_close": string }
  ]
}
Use these exact key names. At most 8 entries in each list, strongest first. No other keys, no
nesting, no prose, no code fences.`;

export interface ResumeGapInputs {
  jd: string;
  resumeText: string;
}

function capped(text: string, max: number, what: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n[cut off here — the ${what} is longer than we send]`;
}

export function resumeGapPrompt(inputs: ResumeGapInputs): string {
  return `JOB DESCRIPTION:
${capped(inputs.jd, GAP_JD_MAX_CHARS, "posting")}

RÉSUMÉ:
${capped(inputs.resumeText, GAP_RESUME_MAX_CHARS, "résumé")}

Compare the résumé against the job description.
List what the résumé genuinely evidences, and what it does not. Anything you cannot point at a line
of the résumé for belongs in "gaps".
Return JSON: { "match_percent": number, "summary": string, "covered": [{ "requirement": string, "evidence": string }], "gaps": [{ "requirement": string, "why_it_matters": string, "how_to_close": string }] }`;
}
