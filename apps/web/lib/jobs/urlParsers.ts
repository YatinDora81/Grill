import { badRequest } from "@/lib/errors";

export type ParsedJobUrl =
  | { kind: "greenhouse"; board: string; jobId: string; api: string }
  | { kind: "lever"; company: string; postingId: string; api: string }
  | { kind: "ashby"; org: string; jobId: string; api: string }
  | { kind: "generic"; url: string };

const SLUG = /^[a-z0-9][a-z0-9\-_]{0,80}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d{1,20}$/;

const GREENHOUSE_HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "boards.eu.greenhouse.io",
  "job-boards.eu.greenhouse.io",
]);

export function parseJobUrl(raw: string): ParsedJobUrl {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw badRequest("That doesn't look like a link to a job posting.", "bad_job_url");
  }
  if (url.protocol !== "https:") {
    throw badRequest("Job links must start with https://.", "bad_job_url");
  }

  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  const [first, second, third] = parts;

  if (
    GREENHOUSE_HOSTS.has(host) &&
    second === "jobs" &&
    SLUG.test(first ?? "") &&
    DIGITS.test(third ?? "")
  ) {
    return {
      kind: "greenhouse",
      board: first!,
      jobId: third!,
      api: `https://boards-api.greenhouse.io/v1/boards/${first}/jobs/${third}`,
    };
  }

  if (host === "jobs.lever.co" && SLUG.test(first ?? "") && UUID.test(second ?? "")) {
    return {
      kind: "lever",
      company: first!,
      postingId: second!,
      api: `https://api.lever.co/v0/postings/${first}/${second}`,
    };
  }

  if (host === "jobs.ashbyhq.com" && SLUG.test(first ?? "") && UUID.test(second ?? "")) {
    return {
      kind: "ashby",
      org: first!,
      jobId: second!,
      api: `https://api.ashbyhq.com/posting-api/job-board/${first}`,
    };
  }

  return { kind: "generic", url: url.toString() };
}

export function companyFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => (word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}
