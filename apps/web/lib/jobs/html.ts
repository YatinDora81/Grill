const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  middot: "·",
  times: "×",
  trade: "™",
  reg: "®",
  copy: "©",
  euro: "€",
  pound: "£",
};

const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,31});/gi;

export function decodeEntities(input: string): string {
  return input.replace(ENTITY, (whole, body: string) => {
    const token = body.toLowerCase();
    if (token.startsWith("#x")) {
      const code = Number.parseInt(body.slice(2), 16);
      return codePoint(code) ?? whole;
    }
    if (token.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return codePoint(code) ?? whole;
    }
    return NAMED_ENTITIES[token] ?? whole;
  });
}

function codePoint(code: number): string | null {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

const DROP_BLOCKS = /<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK_END = /<\/(p|div|section|article|h[1-6]|ul|ol|tr|table|blockquote|pre)\s*>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const LIST_ITEM = /<li\b[^>]*>/gi;
const ANY_TAG = /<[^>]*>/g;

export function stripHtml(input: string): string {
  if (!input) return "";
  const text = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(DROP_BLOCKS, " ")
    .replace(LINE_BREAK, "\n")
    .replace(LIST_ITEM, "\n• ")
    .replace(BLOCK_END, "\n")
    .replace(ANY_TAG, "");

  return collapse(decodeEntities(text));
}

function collapse(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface JsonLdJobPosting {
  title: string;
  company: string | null;
  location: string | null;
  description: string;
}

const SCRIPT_LD = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

export function extractJsonLdJobPosting(html: string): JsonLdJobPosting | null {
  for (const match of html.matchAll(SCRIPT_LD)) {
    const raw = match[1];
    if (!raw || !raw.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.includes("&quot;") ? decodeEntities(raw) : raw);
    } catch {
      continue;
    }
    const found = findJobPosting(parsed, 0);
    if (found) return readJobPosting(found);
  }
  return null;
}

const MAX_LD_DEPTH = 6;

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function findJobPosting(node: unknown, depth: number): Dict | null {
  if (depth > MAX_LD_DEPTH) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isDict(node)) return null;
  if (hasType(node["@type"], "JobPosting")) return node;
  const graph = node["@graph"];
  if (graph !== undefined) return findJobPosting(graph, depth + 1);
  return null;
}

function hasType(value: unknown, wanted: string): boolean {
  if (typeof value === "string") return value.toLowerCase() === wanted.toLowerCase();
  if (Array.isArray(value)) return value.some((v) => hasType(v, wanted));
  return false;
}

function readJobPosting(node: Dict): JsonLdJobPosting {
  return {
    title: text(node.title) ?? text(node.name) ?? "",
    company: readOrganization(node.hiringOrganization),
    location:
      readLocation(node.jobLocation) ??
      (hasType(node.jobLocationType, "TELECOMMUTE") ? "Remote" : null),
    description: text(node.description) ?? "",
  };
}

function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number") return String(value);
  return null;
}

function readOrganization(value: unknown): string | null {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) return readOrganization(value[0]);
  if (isDict(value)) return text(value.name) ?? text(value.legalName);
  return null;
}

function readLocation(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readLocation(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "string") return text(value);
  if (!isDict(value)) return null;

  const address = isDict(value.address) ? value.address : value;
  const parts = [
    text(address.addressLocality),
    text(address.addressRegion),
    text(address.addressCountry) ?? (isDict(address.addressCountry) ? text((address.addressCountry as Dict).name) : null),
  ].filter((p): p is string => p !== null);

  if (parts.length) return parts.join(", ");
  return text(value.name);
}
