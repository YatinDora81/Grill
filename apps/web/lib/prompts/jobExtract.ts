import { JOB_DESCRIPTION_MAX_CHARS } from "@/lib/schemas";

export const JOB_EXTRACT_SYSTEM = `You are given the visible text of ONE web page. Return the job
posting it contains, or say that it contains none.

Rules:
- Copy, do not compose. "description" is the POSTING'S OWN WORDS — what the role does, the
  responsibilities, the requirements, the stack, the team, the level, the comp if it is stated.
  Keep the original phrasing and the original order. Do not summarise, do not rewrite, do not
  translate, do not add a single requirement the page does not state.
- Remove only what is not the posting: navigation, cookie and consent banners, sign-in prompts,
  "similar jobs" and "people also viewed" lists, application forms, legal footers, social links,
  repeated boilerplate about the company's benefits pages, and share buttons.
- "title" is the posting's own job title, nothing else. Never a page title like
  "Careers | Acme" — extract the role from it if that is all there is, otherwise return "".
- "company" is the hiring organisation. If the page never names one, return null. Never guess a
  company from the domain, and never return the job board's name (Indeed, LinkedIn, Naukri) as
  the company.
- "location" is where the page says the role sits, in the page's own words ("Remote — India",
  "Bengaluru", "London, hybrid"). If the page never says, return null.
- If the page is NOT a single job posting — a search results page, a list of openings, a login
  wall, an article, an error page — return "description" as an empty string and do not invent the
  other fields.

Respond with ONLY a single JSON object with EXACTLY these keys and types:
{
  "title": string,
  "company": string | null,
  "location": string | null,
  "description": string
}
No other keys, no prose, no code fences.`;

export const JOB_PAGE_PROMPT_MAX_CHARS = 30_000;

export interface JobExtractContext {
  title?: string;
  url?: string;
}

function capped(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n[cut off here — the page is longer than we send]`;
}

export function jobExtractPrompt(pageText: string, context: JobExtractContext = {}): string {
  const lines: string[] = [];
  if (context.url) lines.push(`PAGE URL: ${context.url}`);
  if (context.title) lines.push(`PAGE TITLE: ${context.title}`);
  const header = lines.length ? `${lines.join("\n")}\n\n` : "";

  return `${header}PAGE TEXT:
${capped(pageText, JOB_PAGE_PROMPT_MAX_CHARS)}

Extract the job posting from this page, in the posting's own words.
If this page is not a single job posting, return "description" as "".
Return JSON: { "title": string, "company": string | null, "location": string | null, "description": string }
"description" must be at most ${JOB_DESCRIPTION_MAX_CHARS} characters.`;
}
