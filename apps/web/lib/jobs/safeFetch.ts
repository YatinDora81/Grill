import "server-only";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { AppError, badRequest } from "@/lib/errors";
import { stripHtml } from "@/lib/jobs/html";

const TIMEOUT_MS = 10_000;
export const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const ALLOWED_TYPES = ["text/html", "application/json"];

const HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Grill/1.0 (+job import)",
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.1",
  "accept-language": "en-US,en;q=0.9",
};

const BLOCKED_SUFFIXES = [".local", ".internal", ".lan", ".localhost", ".home.arpa", ".intranet"];
const BLOCKED_NAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback", "broadcasthost"]);

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateV4(address);
  if (family === 6) return isPrivateV6(address);
  return true;
}

function isPrivateV4(address: string): boolean {
  const octets = address.split(".").map((o) => Number(o));
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return true;
  }
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateV6(address: string): boolean {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (lower === "::1" || lower === "::") return true;
  const embedded = lower.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded?.[1]) return isPrivateV4(embedded[1]);
  const head = lower.split(":")[0] ?? "";
  if (/^f[cd]/.test(head)) return true;
  if (/^fe[89ab]/.test(head)) return true;
  if (/^ff/.test(head)) return true;
  return false;
}

export function isAddressLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return true;
  const labels = host.split(".");
  const last = labels[labels.length - 1] ?? "";
  if (/^\d+$/.test(last)) return true;
  if (/^0[xX][0-9a-fA-F]+$/.test(last)) return true;
  if (labels.length === 1 && /^[0-9a-fA-F]{8}$/.test(last)) return true;
  return false;
}

export function assertAllowedHostname(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw badRequest("That link has no host to read.", "blocked_url");
  if (isAddressLiteral(host)) {
    throw badRequest("Links to IP addresses can't be imported.", "blocked_url");
  }
  if (BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw badRequest("That link points inside a private network.", "blocked_url");
  }
}

export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:") {
    throw badRequest("Job links must start with https://.", "blocked_url");
  }
  assertAllowedHostname(url.hostname);

  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname.replace(/\.$/, ""), { all: true });
  } catch {
    throw badRequest("We couldn't find that site.", "host_not_found");
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw badRequest("That link points inside a private network.", "blocked_url");
  }
}

export async function safeFetch(rawUrl: string): Promise<SafeFetchResult> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw badRequest("That doesn't look like a link to a job posting.", "bad_job_url");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current);

    let res: Response;
    try {
      res = await fetch(current.toString(), {
        headers: HEADERS,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw badRequest("We couldn't read that page. Paste the posting instead.", "fetch_failed");
    }

    if (isRedirect(res.status)) {
      const location = res.headers.get("location");
      await discard(res);
      if (!location) {
        throw badRequest("That link goes nowhere we can read.", "fetch_failed");
      }
      if (hop === MAX_REDIRECTS) {
        throw badRequest("That link redirects too many times.", "too_many_redirects");
      }
      try {
        current = new URL(location, current);
      } catch {
        throw badRequest("That link redirects somewhere we can't read.", "blocked_url");
      }
      continue;
    }

    if (res.status === 401 || res.status === 403 || res.status === 999) {
      await discard(res);
      throw loginWall();
    }
    if (!res.ok) {
      await discard(res);
      throw badRequest("We couldn't read that page. Paste the posting instead.", "fetch_failed");
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const mime = contentType.split(";")[0]?.trim() ?? "";
    if (!ALLOWED_TYPES.includes(mime)) {
      await discard(res);
      throw badRequest("That link isn't a web page we can read.", "unsupported_content");
    }

    const body = await readCapped(res);
    if (mime === "text/html" && looksLikeLoginWall(body)) throw loginWall();

    return { url: current.toString(), status: res.status, contentType: mime, body };
  }

  throw badRequest("That link redirects too many times.", "too_many_redirects");
}

export async function safeFetchHtml(rawUrl: string): Promise<string> {
  const { body } = await safeFetch(rawUrl);
  return body;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function loginWall(): AppError {
  return new AppError(
    422,
    "login_wall",
    "That page needs a login before it will show the posting. Use the bookmarklet, or paste the text.",
  );
}

const LOGIN_TITLE = /\b(sign in|sign-in|log in|login|join now|create account|authwall)\b/i;
const SHORT_PAGE_CHARS = 500;

export function looksLikeLoginWall(html: string): boolean {
  const title = html.match(/<title\b[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] ?? "";
  if (!LOGIN_TITLE.test(title)) return false;
  return stripHtml(html).length < SHORT_PAGE_CHARS;
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const chunks: string[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        throw badRequest("That page is too large to read.", "page_too_large");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}
