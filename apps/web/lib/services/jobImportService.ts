import "server-only";
import type { JobImportResponse } from "@repo/types";
import { AppError, notFound } from "@/lib/errors";
import {
  JOB_DESCRIPTION_MAX_CHARS,
  JOB_DESCRIPTION_MIN_CHARS,
  jobExtractSchema,
} from "@/lib/schemas";
import { generateJson } from "@/lib/clients/llmJson";
import { JOB_EXTRACT_SYSTEM, jobExtractPrompt } from "@/lib/prompts/jobExtract";
import { decodeEntities, extractJsonLdJobPosting, stripHtml } from "@/lib/jobs/html";
import { safeFetchHtml } from "@/lib/jobs/safeFetch";
import { companyFromSlug, parseJobUrl, type ParsedJobUrl } from "@/lib/jobs/urlParsers";

const ATS_TIMEOUT_MS = 10_000;
const ATS_MAX_BYTES = 4 * 1024 * 1024;

function notAPosting(): AppError {
  return new AppError(
    422,
    "not_a_posting",
    "We couldn't find a job posting on that page. Paste the description instead.",
  );
}

function cap(text: string, max = JOB_DESCRIPTION_MAX_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd();
}

function orNull(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed.slice(0, max);
}

async function getJson<T>(api: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(api, {
      headers: { accept: "application/json", "user-agent": "grill-app" },
      signal: AbortSignal.timeout(ATS_TIMEOUT_MS),
    });
  } catch {
    throw new AppError(
      502,
      "board_unavailable",
      "That job board isn't answering right now — try again shortly, or paste the description.",
    );
  }
  if (res.status === 404) throw notFound("That posting isn't on the board any more.", "job_not_found");
  if (!res.ok) {
    throw new AppError(
      502,
      "board_unavailable",
      `That job board returned an error (status ${res.status}). Paste the description instead.`,
    );
  }

  const raw = await res.text();
  if (raw.length > ATS_MAX_BYTES) {
    throw new AppError(502, "board_unavailable", "That job board's response was too large to read.");
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AppError(502, "board_unavailable", "That job board sent something we couldn't read.");
  }
}

interface GreenhouseJob {
  title?: string;
  content?: string;
  location?: { name?: string } | null;
  company_name?: string;
}

interface LeverJob {
  text?: string;
  descriptionPlain?: string;
  description?: string;
  lists?: { text?: string; content?: string }[];
  additionalPlain?: string;
  categories?: { location?: string; team?: string; commitment?: string } | null;
}

interface AshbyBoard {
  jobs?: {
    id?: string;
    title?: string;
    descriptionPlain?: string;
    descriptionHtml?: string;
    location?: string;
  }[];
}

export async function importJob(rawUrl: string): Promise<JobImportResponse> {
  const parsed = parseJobUrl(rawUrl);
  switch (parsed.kind) {
    case "greenhouse":
      return importGreenhouse(parsed, rawUrl);
    case "lever":
      return importLever(parsed, rawUrl);
    case "ashby":
      return importAshby(parsed, rawUrl);
    case "generic":
      return importGeneric(parsed.url);
  }
}

async function importGreenhouse(
  parsed: Extract<ParsedJobUrl, { kind: "greenhouse" }>,
  rawUrl: string,
): Promise<JobImportResponse> {
  const job = await getJson<GreenhouseJob>(parsed.api);
  const description = cap(stripHtml(decodeEntities(job.content ?? "")));
  if (description.length < JOB_DESCRIPTION_MIN_CHARS) throw notAPosting();
  return {
    title: orNull(job.title) ?? "",
    company: orNull(job.company_name) ?? companyFromSlug(parsed.board),
    location: orNull(job.location?.name),
    description,
    source: "greenhouse",
    url: rawUrl,
  };
}

async function importLever(
  parsed: Extract<ParsedJobUrl, { kind: "lever" }>,
  rawUrl: string,
): Promise<JobImportResponse> {
  const job = await getJson<LeverJob>(parsed.api);
  const lists = (job.lists ?? [])
    .map((list) => {
      const heading = orNull(list.text) ?? "";
      const body = stripHtml(list.content ?? "");
      return [heading, body].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
  const description = cap(
    [stripHtml(job.descriptionPlain ?? job.description ?? ""), lists, orNull(job.additionalPlain, 20_000) ?? ""]
      .filter(Boolean)
      .join("\n\n"),
  );
  if (description.length < JOB_DESCRIPTION_MIN_CHARS) throw notAPosting();
  return {
    title: orNull(job.text) ?? "",
    company: companyFromSlug(parsed.company),
    location: orNull(job.categories?.location),
    description,
    source: "lever",
    url: rawUrl,
  };
}

async function importAshby(
  parsed: Extract<ParsedJobUrl, { kind: "ashby" }>,
  rawUrl: string,
): Promise<JobImportResponse> {
  const board = await getJson<AshbyBoard>(parsed.api);
  const job = (board.jobs ?? []).find((j) => j.id === parsed.jobId);
  if (!job) throw notFound("That posting isn't on the board any more.", "job_not_found");
  const description = cap(
    orNull(job.descriptionPlain, JOB_DESCRIPTION_MAX_CHARS) ?? stripHtml(job.descriptionHtml ?? ""),
  );
  if (description.length < JOB_DESCRIPTION_MIN_CHARS) throw notAPosting();
  return {
    title: orNull(job.title) ?? "",
    company: companyFromSlug(parsed.org),
    location: orNull(job.location),
    description,
    source: "ashby",
    url: rawUrl,
  };
}

async function importGeneric(url: string): Promise<JobImportResponse> {
  const html = await safeFetchHtml(url);

  const ld = extractJsonLdJobPosting(html);
  if (ld) {
    const description = cap(stripHtml(ld.description));
    if (description.length >= JOB_DESCRIPTION_MIN_CHARS) {
      return {
        title: orNull(ld.title) ?? "",
        company: orNull(ld.company, 120),
        location: orNull(ld.location),
        description,
        source: "generic",
        url,
      };
    }
  }

  return extractWithModel(stripHtml(html), { url }, "generic", url);
}

export async function importJobFromPageText(input: {
  url: string;
  pageTitle?: string;
  pageText: string;
}): Promise<JobImportResponse> {
  return extractWithModel(
    input.pageText,
    { url: input.url, title: input.pageTitle },
    "bookmarklet",
    input.url,
    input.pageTitle,
  );
}

async function extractWithModel(
  pageText: string,
  context: { url?: string; title?: string },
  source: JobImportResponse["source"],
  url: string,
  fallbackTitle?: string,
): Promise<JobImportResponse> {
  if (pageText.trim().length < JOB_DESCRIPTION_MIN_CHARS) throw notAPosting();

  const { value } = await generateJson(jobExtractSchema, {
    system: JOB_EXTRACT_SYSTEM,
    prompt: jobExtractPrompt(pageText, context),
    temperature: 0.1,
  });

  const description = cap(value.description);
  if (description.length < JOB_DESCRIPTION_MIN_CHARS) throw notAPosting();

  return {
    title: orNull(value.title) ?? orNull(fallbackTitle) ?? "",
    company: orNull(value.company, 120),
    location: orNull(value.location),
    description,
    source,
    url,
  };
}
