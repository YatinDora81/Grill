import "server-only";
import type { CompanyBrief, CompanyBriefResponse, GroundingSource } from "@repo/types";
import { serviceUnavailable } from "@/lib/errors";
import { generateJson } from "@/lib/clients/llmJson";
import * as repo from "@/lib/db/repo";
import { briefSourcesSchema, companyBriefSchema } from "@/lib/schemas";
import { COMPANY_BRIEF_SYSTEM, companyBriefPrompt } from "@/lib/prompts/companyBrief";

export const BRIEF_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const KEY_MAX_CHARS = 120;

const BRIEF_TIMEOUT_MS = 40_000;
const FALLBACK_TIMEOUT_MS = 20_000;

const SEARCH_TOOLS = [{ google_search: {} }];

const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "ltd",
  "limited",
  "pvt",
  "private",
  "plc",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "ag",
  "sa",
  "bv",
  "nv",
  "oy",
  "ab",
  "technologies",
  "technology",
  "labs",
  "laboratories",
  "holdings",
  "group",
  "international",
]);

function clean(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9&+]+/g, " ")
    .trim();
}

export function companyKey(raw: string): string {
  const cleaned = clean(raw);
  const words = cleaned.split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  const stripped = words.join(" ");
  return (stripped || cleaned || raw.trim().toLowerCase()).slice(0, KEY_MAX_CHARS);
}

export function roleKey(raw: string | null | undefined): string {
  if (!raw) return "";
  return clean(raw).slice(0, KEY_MAX_CHARS);
}

export interface BriefRequest {
  company: string;
  role?: string | null;
}

interface Subject {
  company: string;
  role: string | null;
  companyKey: string;
  roleKey: string;
}

function subjectOf(input: BriefRequest): Subject {
  const company = input.company.trim();
  const role = input.role?.trim() ? input.role.trim() : null;
  return { company, role, companyKey: companyKey(company), roleKey: roleKey(role) };
}

function toResponse(
  row: { brief: unknown; sources: unknown; grounded: boolean; createdAt: Date },
  cached: boolean,
): CompanyBriefResponse | null {
  const parsed = companyBriefSchema.safeParse(row.brief);
  if (!parsed.success) {
    console.warn("[companyBriefService] stored brief did not parse; treating it as a miss.");
    return null;
  }
  const sources = briefSourcesSchema.parse(row.sources);
  return {
    brief: parsed.data,
    grounded: row.grounded && sources.length > 0,
    sources,
    cached,
    generated_at: row.createdAt.toISOString(),
  };
}

export async function readCachedBrief(input: BriefRequest): Promise<CompanyBriefResponse | null> {
  const subject = subjectOf(input);
  const row = await repo.getCompanyBrief(subject.companyKey, subject.roleKey);
  if (!row) return null;
  if (Date.now() - row.createdAt.getTime() > BRIEF_TTL_MS) return null;
  return toResponse(row, true);
}

export async function briefForQuestions(
  company: string | null | undefined,
  role: string | null | undefined,
): Promise<{ values: string[]; style_notes: string[] } | null> {
  if (!company?.trim()) return null;
  const hit = await readCachedBrief({ company, role });
  if (!hit) return null;
  const { values, interview_style_notes } = hit.brief;
  if (values.length === 0 && interview_style_notes.length === 0) return null;
  return { values, style_notes: interview_style_notes };
}

function hasSubstance(brief: CompanyBrief): boolean {
  return (
    brief.what_they_do.length > 0 ||
    brief.recent_news.length > 0 ||
    brief.values.length > 0 ||
    brief.interview_style_notes.length > 0 ||
    brief.likely_questions.length > 0 ||
    brief.questions_to_ask.length > 0
  );
}

interface Research {
  brief: CompanyBrief;
  grounded: boolean;
  sources: GroundingSource[];
  raw: unknown;
}

async function research(subject: Subject): Promise<Research> {
  const prompt = companyBriefPrompt(subject.company, subject.role);
  const opts = { system: COMPANY_BRIEF_SYSTEM, prompt, temperature: 0.3 };

  try {
    const { value, raw, sources } = await generateJson(companyBriefSchema, {
      ...opts,
      timeoutMs: BRIEF_TIMEOUT_MS,
      tools: SEARCH_TOOLS,
    });
    if (hasSubstance(value)) {
      const grounded = briefSourcesSchema.parse(sources);
      return {
        brief: value,
        grounded: grounded.length > 0,
        sources: grounded,
        raw: { brief: value, raw_text: raw, grounded: grounded.length > 0 },
      };
    }
    console.warn("[companyBriefService] grounded research came back empty — trying ungrounded.");
  } catch (err) {
    console.warn("[companyBriefService] grounded research failed — trying ungrounded:", err);
  }

  try {
    const { value, raw } = await generateJson(companyBriefSchema, {
      ...opts,
      timeoutMs: FALLBACK_TIMEOUT_MS,
    });
    if (!hasSubstance(value)) throw new Error("the model returned an empty brief");
    return {
      brief: value,
      grounded: false,
      sources: [],
      raw: { brief: value, raw_text: raw, grounded: false },
    };
  } catch (err) {
    console.error("[companyBriefService] could not research a company:", err);
    throw serviceUnavailable(
      "Couldn't research that company right now. Give it a minute and try again.",
      "brief_unavailable",
    );
  }
}

export async function buildBrief(input: BriefRequest): Promise<CompanyBriefResponse> {
  const subject = subjectOf(input);
  const found = await research(subject);
  const row = await repo.upsertCompanyBrief({
    companyKey: subject.companyKey,
    roleKey: subject.roleKey,
    company: subject.company,
    role: subject.role,
    brief: found.brief,
    grounded: found.grounded,
    sources: found.sources,
    raw: found.raw,
  });
  return {
    brief: found.brief,
    grounded: found.grounded,
    sources: found.sources,
    cached: false,
    generated_at: row.createdAt.toISOString(),
  };
}

export interface GetBriefInput extends BriefRequest {
  refresh?: boolean;
}

export async function getBrief(input: GetBriefInput): Promise<CompanyBriefResponse> {
  if (!input.refresh) {
    const hit = await readCachedBrief(input);
    if (hit) return hit;
  }
  return await buildBrief(input);
}
