import "server-only";
/**
 * GitHub repo → interviewer digest, run ONCE at creation time.
 *
 * Mirrors resumeService: the expensive ingestion happens once in the extract
 * endpoint, and /start only ever takes the resulting text. The interview never
 * talks to GitHub.
 *
 * Ingestion is a single tarball download, not a fan-out of per-file API calls:
 *   meta + languages + `GET /tarball/{ref}`  →  stream-extract (gunzip + tar) →
 *   filter junk in code  →  build a pack  →  digest (one call, or map-reduce).
 * Three GitHub requests total, so rate limits stop being a real constraint, and
 * the model reads EVERY kept source file — no selection, no sampling.
 *
 * SECURITY (§8): the raw user string is NEVER fetched. owner/repo/ref are parsed
 * out and validated, and every request URL is built from those parts against the
 * api.github.com literal. Streaming caps (per-entry / total / entry-count) are
 * the DoS defence — a hostile tarball can't balloon memory (see §7 memory math
 * in TARBALL_STREAMING_README).
 */
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";
import { config } from "@/lib/env";
import { AppError, badRequest, notFound } from "@/lib/errors";
import { generateJson } from "@/lib/clients/llmJson";
import { generateText } from "@/lib/clients/llmClient";
import {
  PROJECT_DIGEST_SYSTEM,
  PROJECT_MAP_SYSTEM,
  projectDigestSchema,
  renderDigest,
  type ProjectDigest,
} from "@/lib/prompts/projectDigest";

// ── Gates & budgets ───────────────────────────────────────────────
/** Metadata `size` (KB) gate: refuse a repo this big before downloading it. */
const MAX_REPO_KB = 200_000; // ~200 MB compressed
/** GitHub JSON calls are fast; a hung one must not hold the request open. */
const GITHUB_TIMEOUT_MS = 10_000;
/** Extraction must never eat the LLM calls' share of the route's 60 s. */
const EXTRACT_DEADLINE_MS = 20_000;
/** The rendered digest the textarea shows, capped to the schema's field max. */
const MAX_DIGEST_CHARS = 24_000;
/**
 * The whole extract must finish inside the route's maxDuration (60 s), or the
 * PLATFORM kills it at 60 s (504) before our own degradation can run. So the
 * digest works to a wall clock set under that: every LLM call's timeout is the
 * time left on this budget (capped at DIGEST_TIMEOUT_MS), and once too little is
 * left we skip the model and return the deterministic fallback rather than 504.
 */
const ROUTE_BUDGET_MS = 55_000;
/** Below this much remaining budget, don't start an LLM call — go to fallback. */
const MIN_DIGEST_MS = 6_000;

/** Streaming extraction caps — the zip-bomb / OOM defence. */
export const EXTRACT_CAPS = {
  perEntryBytes: 400 * 1024, // skip any single file bigger than this, from its header
  perFileChars: 25_000, // keep at most this much of a kept file
  maxTotalChars: 4_000_000, // whole-pack ceiling (~1M tokens)
  maxEntries: 20_000,
} as const;

// ── Digest budgets ────────────────────────────────────────────────
/**
 * If the whole pack fits within this, ONE digest call reads all of it. Gemini
 * 2.5 Flash's ~1M-token window takes ~175 K tokens comfortably. A pack this big
 * exceeds the Groq fallback's context, so a failed full dump does NOT fall to
 * Groq — it drops to map-reduce, whose chunks fit both providers.
 */
const FULL_DUMP_MAX_CHARS = 700_000;
/** One MAP chunk (~22 K tokens): fits Gemini AND the Groq fallback. */
const CHUNK_CHARS = 90_000;
/** Beyond this many chunks the remaining files are named-only; the digest says so. */
const MAX_CHUNKS = 24;
/** MAP calls in flight at once — bounded so a burst doesn't trip provider 429s. */
const CHUNK_CONCURRENCY = 5;
/** Each map brief is trimmed to this before the merge, to keep merge input small. */
const MAP_NOTE_CHARS = 4_000;
/** Digest calls carry big inputs; give them more than the default per-call timeout. */
const DIGEST_TIMEOUT_MS = 90_000;

const GITHUB_API = "https://api.github.com";

// ── URL parsing (§7) ──────────────────────────────────────────────

export interface ParsedRepo {
  owner: string;
  repo: string;
  /** Branch/ref, when the URL named one via /tree/{ref}. */
  ref?: string;
  /** Monorepo focus hint — extracted entries are filtered to this prefix. */
  subpath?: string;
}

/** owner / repo / ref segments must each be a plain path atom — never a payload. */
const SEGMENT = /^[\w.-]+$/;

/**
 * Accepts github.com/{owner}/{repo}, optional `.git`, optional `/tree/{ref}` and
 * optional `/tree/{ref}/{subpath}`. Rejects every other host and shape — this is
 * the only place a user-supplied string is turned into request parts.
 */
export function parseRepoUrl(raw: string): ParsedRepo {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw badRequest("That doesn't look like a GitHub URL.", "bad_repo_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw badRequest("That doesn't look like a GitHub URL.", "bad_repo_url");
  }
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    throw badRequest("Only public github.com repositories are supported.", "bad_repo_url");
  }

  const segs = url.pathname.split("/").filter(Boolean);
  if (segs.length < 2) {
    throw badRequest("Point at a repository: github.com/owner/repo.", "bad_repo_url");
  }
  const owner = segs[0]!;
  const repo = segs[1]!.replace(/\.git$/i, "");
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) {
    throw badRequest("That doesn't look like a GitHub URL.", "bad_repo_url");
  }

  const parsed: ParsedRepo = { owner, repo };

  if (segs.length >= 4 && segs[2] === "tree") {
    const ref = segs[3]!;
    if (!SEGMENT.test(ref)) throw badRequest("That branch name isn't valid.", "bad_repo_url");
    parsed.ref = ref;
    const rest = segs.slice(4);
    if (rest.length) {
      if (!rest.every((s) => SEGMENT.test(s))) {
        throw badRequest("That path in the URL isn't valid.", "bad_repo_url");
      }
      parsed.subpath = rest.join("/");
    }
  } else if (segs.length > 2) {
    throw badRequest(
      "Link the repository itself, or a branch: github.com/owner/repo.",
      "bad_repo_url",
    );
  }

  return parsed;
}

// ── GitHub client ─────────────────────────────────────────────────

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "grill-app",
  };
  if (config.github.token) headers.Authorization = `Bearer ${config.github.token}`;
  return headers;
}

/** GitHub is unreachable / rate-limited / 5xx — mapped to 502 by the route. */
function githubUnavailable(res: Response): AppError {
  const remaining = res.headers.get("x-ratelimit-remaining");
  const detail =
    remaining === "0"
      ? "GitHub's API rate limit is exhausted — try again shortly, or set GITHUB_TOKEN."
      : `GitHub is unavailable right now (status ${res.status}).`;
  // Status + rate-limit only. The token must never reach a log or a message.
  return new AppError(502, "github_unavailable", detail);
}

async function ghJson<T>(path: string, allow404 = false): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch {
    throw new AppError(502, "github_unavailable", "Couldn't reach GitHub — try again shortly.");
  }
  if (res.ok) return (await res.json()) as T;
  if (res.status === 404 && allow404) return null;
  if (res.status === 404) throw notFound("Not found.", "repo_not_found");
  throw githubUnavailable(res);
}

export interface RepoMeta {
  owner: string;
  repo: string;
  ref: string;
  description: string;
  language: string;
  topics: string[];
  stars: number;
  size: number; // KB
  fork: boolean;
  parent: string | null;
  pushed_at: string;
}

async function fetchRepoMeta(owner: string, repo: string, ref?: string): Promise<RepoMeta> {
  const d = await ghJson<{
    default_branch?: string;
    description?: string | null;
    language?: string | null;
    topics?: string[];
    stargazers_count?: number;
    size?: number;
    fork?: boolean;
    parent?: { full_name?: string } | null;
    pushed_at?: string;
  }>(`/repos/${owner}/${repo}`, true);
  if (!d) {
    throw notFound(
      "Repo not found — private repos aren't supported yet. Make it public or paste a description instead.",
      "repo_not_found",
    );
  }
  return {
    owner,
    repo,
    ref: ref || d.default_branch || "HEAD",
    description: d.description ?? "",
    language: d.language ?? "",
    topics: Array.isArray(d.topics) ? d.topics : [],
    stars: d.stargazers_count ?? 0,
    size: d.size ?? 0,
    fork: Boolean(d.fork),
    parent: d.fork ? (d.parent?.full_name ?? null) : null,
    pushed_at: d.pushed_at ?? "",
  };
}

async function fetchLanguages(owner: string, repo: string): Promise<Record<string, number>> {
  return (await ghJson<Record<string, number>>(`/repos/${owner}/${repo}/languages`, true)) ?? {};
}

// ── Streaming tarball extraction (see TARBALL_STREAMING_README) ────

export interface ExtractedFile {
  path: string;
  text: string;
  truncatedFile: boolean;
}
export interface ExtractResult {
  files: ExtractedFile[];
  totalChars: number;
  truncated: boolean;
  entryCount: number;
}

/** GitHub prefixes every tarball path with `{owner}-{repo}-{sha}/`; drop it. */
function stripRoot(name: string): string {
  const i = name.indexOf("/");
  return i === -1 ? "" : name.slice(i + 1);
}

/** Directory / file patterns never worth reading. Dir tokens are segment-anchored. */
const SKIP: RegExp[] = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)vendor\//,
  /(^|\/)\.git\//,
  /(^|\/)\.next\//,
  /(^|\/)target\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|poetry\.lock|gemfile\.lock|composer\.lock|go\.sum)$/i,
  /\.min\.(js|css)$/i,
  /\.(png|jpe?g|gif|svg|ico|webp|bmp|tiff?|mp4|mov|avi|webm|mp3|wav|flac|ogg|pdf|zip|gz|tgz|tar|rar|7z|woff2?|ttf|eot|otf|bin|exe|dll|so|dylib|class|jar|wasm|o|a|map|snap|lock|tsbuildinfo)$/i,
];

const MANIFEST = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "cargo.toml",
  "pom.xml",
  "build.gradle",
  "gemfile",
  "composer.json",
  "turbo.json",
  "pnpm-workspace.yaml",
  "schema.prisma",
]);

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase();
}

/** README first (author's framing), then manifests, then path order. */
function sortFiles(files: ExtractedFile[]): void {
  const rank = (p: string): number => {
    const b = basename(p);
    if (b.startsWith("readme")) return 0;
    if (MANIFEST.has(b)) return 1;
    return 2;
  };
  files.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

function normalizedSubpath(subpath?: string): string | undefined {
  if (!subpath) return undefined;
  return subpath.endsWith("/") ? subpath : `${subpath}/`;
}

/**
 * Stream a gzipped tarball into a filtered, capped, in-memory pack. Every entry's
 * stream is fully drained and `next()` is called exactly once on every path —
 * miss either and the pipeline stalls silently (see README §4). Caps are checked
 * from the header before bytes are read; hitting a global cap aborts the download.
 */
export async function extractRepoTarball(
  body: ReadableStream<Uint8Array>,
  opts: { subpath?: string; abort: () => void; caps?: typeof EXTRACT_CAPS },
): Promise<ExtractResult> {
  const caps = opts.caps ?? EXTRACT_CAPS;
  const prefix = normalizedSubpath(opts.subpath);
  const state: ExtractResult = { files: [], totalChars: 0, truncated: false, entryCount: 0 };
  const extract = tar.extract();

  extract.on("entry", (header, stream, next) => {
    state.entryCount += 1;
    // The entry-count cap must bind even when every entry is skipped/binary (a
    // committed node_modules/ would otherwise stream in full): abort here, not
    // only from a kept file's end handler.
    if (state.entryCount > caps.maxEntries) {
      if (!state.truncated) {
        state.truncated = true;
        opts.abort();
      }
      stream.resume();
      next();
      return;
    }
    const path = stripRoot(header.name);
    const keepIt =
      header.type === "file" &&
      path.length > 0 &&
      !path.split("/").includes("..") &&
      (!prefix || path === opts.subpath || path.startsWith(prefix)) &&
      !SKIP.some((re) => re.test(path)) &&
      (header.size ?? 0) <= caps.perEntryBytes &&
      state.entryCount <= caps.maxEntries &&
      state.totalChars < caps.maxTotalChars;

    if (!keepIt) {
      stream.resume(); // drain without buffering
      next();
      return;
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    let binary = false;
    let first = true;

    stream.on("data", (c: Buffer) => {
      if (first) {
        first = false;
        if (c.subarray(0, 1024).includes(0)) binary = true; // NUL sniff — non-text
      }
      if (binary) return; // decision made; keep draining, keep nothing
      if (bytes < caps.perFileChars * 4) {
        chunks.push(c); // ×4 utf-8 headroom so the char cap is reachable
        bytes += c.length;
      }
    });

    stream.on("end", () => {
      if (!binary && chunks.length) {
        let text = Buffer.concat(chunks).toString("utf8"); // concat THEN decode: multi-byte
        const truncatedFile = text.length > caps.perFileChars;
        if (truncatedFile) text = text.slice(0, caps.perFileChars);
        state.files.push({ path, text, truncatedFile });
        state.totalChars += text.length;
        if (state.totalChars >= caps.maxTotalChars || state.entryCount >= caps.maxEntries) {
          state.truncated = true;
          opts.abort(); // stop the download itself (§5)
        }
      }
      next();
    });

    stream.on("error", () => next()); // even the error path advances the parser
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pipeline(Readable.fromWeb(body as any), createGunzip(), extract);
  } catch (err) {
    // An abort we triggered on a global cap is success, not failure.
    const expected = state.truncated && (err as Error)?.name === "AbortError";
    if (!expected) throw err;
  }

  sortFiles(state.files);
  return state;
}

/** Download the tarball and extract it, aborting the download when caps hit. */
async function fetchAndExtractTarball(
  owner: string,
  repo: string,
  ref: string,
  subpath?: string,
): Promise<ExtractResult> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(EXTRACT_DEADLINE_MS)]);
  const url = `${GITHUB_API}/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: ghHeaders(), signal, redirect: "follow" });
  } catch {
    throw new AppError(502, "github_unavailable", "Couldn't reach GitHub — try again shortly.");
  }
  // Check status BEFORE piping — a 404/403 body is HTML/JSON, not gzip, and
  // feeding it to gunzip yields a useless "incorrect header check" error.
  if (!res.ok || !res.body) {
    if (res.status === 404) throw notFound("That branch doesn't exist in the repo.", "repo_not_found");
    throw githubUnavailable(res);
  }

  try {
    return await extractRepoTarball(res.body, { subpath, abort: () => controller.abort() });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // A deadline abort without a cap hit, a corrupt gzip, a dropped connection.
    throw new AppError(502, "github_unavailable", "Couldn't read the repo archive — try again.");
  }
}

// ── Pack builder ──────────────────────────────────────────────────

/** Repo metadata + language table header, shared by full-dump and merge. */
function metaHeader(meta: RepoMeta, languages: Record<string, number>): string {
  const langLine =
    Object.entries(languages)
      .sort((a, b) => b[1] - a[1])
      .map(([lang, bytes]) => `${lang} (${bytes})`)
      .join(", ") ||
    meta.language ||
    "(unknown)";
  return [
    `Repository: ${meta.owner}/${meta.repo}`,
    meta.description && `Description: ${meta.description}`,
    meta.topics.length ? `Topics: ${meta.topics.join(", ")}` : "",
    `Primary language: ${meta.language || "(unknown)"} · Stars: ${meta.stars} · Last push: ${meta.pushed_at || "(unknown)"}`,
    meta.fork ? `NOTE: this repo is a fork of ${meta.parent ?? "another repo"}.` : "",
    `Languages: ${langLine}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The whole pack: metadata header + every kept file under a `=== path ===` head. */
export function buildPack(
  meta: RepoMeta,
  languages: Record<string, number>,
  files: ExtractedFile[],
): string {
  const body = files.map((f) => `=== ${f.path} ===\n${f.text}`).join("\n\n");
  return `${metaHeader(meta, languages)}\n\n${body}`;
}

/** Group files by top-level dir, greedy-fill chunks of ≤ CHUNK_CHARS. */
export function chunkFiles(files: ExtractedFile[]): string[] {
  const byDir = new Map<string, ExtractedFile[]>();
  for (const f of files) {
    const top = f.path.includes("/") ? f.path.slice(0, f.path.indexOf("/")) : "(root)";
    const group = byDir.get(top);
    if (group) group.push(f);
    else byDir.set(top, [f]);
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  const flush = () => {
    if (current.length) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentLen = 0;
    }
  };
  for (const group of byDir.values()) {
    for (const f of group) {
      const block = `=== ${f.path} ===\n${f.text}`;
      if (currentLen + block.length > CHUNK_CHARS && current.length) flush();
      current.push(block);
      currentLen += block.length + 2;
    }
  }
  flush();
  return chunks;
}

/** Bounded-concurrency map — keeps fan-out from tripping provider rate limits. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Digest (§3 Stage C) ───────────────────────────────────────────

/** The honesty line that rides at the top of the digest (fork / truncation). */
function digestNote(meta: RepoMeta, truncated: boolean): string {
  const notes: string[] = [];
  if (meta.fork) notes.push(`Note: this repo is a fork of ${meta.parent ?? "another repo"}.`);
  if (truncated) {
    notes.push(
      "Note: very large repo — only part of it was read. Edit the summary to add anything missing.",
    );
  }
  return notes.join("\n");
}

/**
 * Deterministic digest for when the LLM is unreachable entirely. Metadata +
 * README head + file list — degraded, but the user can edit it. Never a dead end.
 */
export function fallbackDigest(meta: RepoMeta, files: ExtractedFile[], truncated: boolean): string {
  const note = digestNote(meta, truncated);
  const digest: ProjectDigest = {
    summary:
      meta.description ||
      `${meta.owner}/${meta.repo} — a ${meta.language || "software"} project. (Automatic summary unavailable; edit this with what it actually does.)`,
    tech_stack: [meta.language].filter(Boolean) as string[],
    architecture: "",
    key_features: [],
    data_and_apis: "",
    notable_decisions: [],
    risks_and_gaps: [],
    question_seeds: [],
  };
  const readme = files.find((f) => basename(f.path).startsWith("readme"));
  const fileList = files.map((f) => `- ${f.path}`).join("\n");
  const raw =
    (readme ? `=== ${readme.path} ===\n${readme.text.slice(0, 4_000)}\n\n` : "") +
    `=== files ===\n${fileList}`;
  return `${renderDigest(digest, note)}\n\n=== raw repo pack (unsummarised) ===\n${raw}`.slice(
    0,
    MAX_DIGEST_CHARS,
  );
}

/** Backfill a blank summary from metadata rather than showing an empty section. */
function withSummary(value: ProjectDigest, meta: RepoMeta): ProjectDigest {
  if (value.summary.trim()) return value;
  return {
    ...value,
    summary:
      meta.description || `${meta.owner}/${meta.repo} — a ${meta.language || "software"} project.`,
  };
}

/** Per-call LLM timeout: whatever's left of the route budget, capped, floored. */
function callTimeout(deadline: number): number {
  return Math.min(DIGEST_TIMEOUT_MS, Math.max(MIN_DIGEST_MS, deadline - Date.now()));
}

/** One call over the whole pack. Throws on failure so the caller can map-reduce. */
async function fullDump(pack: string, deadline: number): Promise<ProjectDigest> {
  const { value } = await generateJson(projectDigestSchema, {
    system: PROJECT_DIGEST_SYSTEM,
    prompt: pack,
    temperature: 0.4,
    timeoutMs: callTimeout(deadline),
  });
  return value;
}

/**
 * Map-reduce: each chunk gets a plain-text brief (MAP, bounded-parallel), then
 * one merge call combines the briefs into the final digest (REDUCE). Plain-text
 * map on purpose — per-chunk JSON invites Gemini object-vs-string schema misses
 * that would fail the whole import. Throws if the LLM is unreachable.
 */
async function mapReduce(
  files: ExtractedFile[],
  meta: RepoMeta,
  languages: Record<string, number>,
  deadline: number,
): Promise<{ value: ProjectDigest; partial: boolean }> {
  const allChunks = chunkFiles(files);
  const chunks = allChunks.slice(0, MAX_CHUNKS);
  const partial = allChunks.length > chunks.length;
  if (partial) {
    console.warn(
      `[projectService] ${meta.owner}/${meta.repo}: ${allChunks.length} chunks, capped to ${chunks.length}.`,
    );
  }

  const briefs = await pool(chunks, CHUNK_CONCURRENCY, async (chunk, i) => {
    try {
      const notes = await generateText({
        system: PROJECT_MAP_SYSTEM,
        prompt: `Slice ${i + 1} of ${chunks.length} of ${meta.owner}/${meta.repo}:\n\n${chunk}`,
        temperature: 0.3,
        timeoutMs: callTimeout(deadline),
      });
      return notes.trim().slice(0, MAP_NOTE_CHARS);
    } catch (err) {
      console.warn(`[projectService] map chunk ${i + 1}/${chunks.length} failed:`, err);
      return "";
    }
  });

  const kept = briefs.filter(Boolean);
  if (kept.length === 0) throw new Error("every map chunk failed");

  const material = kept.map((s, i) => `--- slice ${i + 1} brief ---\n${s}`).join("\n\n");
  const { value } = await generateJson(projectDigestSchema, {
    system: PROJECT_DIGEST_SYSTEM,
    prompt: `${metaHeader(meta, languages)}\n\nThe slice briefs below each summarise part of the repo. Combine them into one interviewer's brief:\n\n${material}`,
    temperature: 0.4,
    timeoutMs: callTimeout(deadline),
  });
  return { value, partial };
}

/**
 * Size-routed digest: full dump when the pack fits one call, else map-reduce. A
 * failed full dump drops to map-reduce (its chunks fit both providers); only a
 * total LLM outage falls to the deterministic digest.
 */
async function digestPack(
  extracted: ExtractResult,
  meta: RepoMeta,
  languages: Record<string, number>,
  deadline: number,
): Promise<string> {
  const { files, totalChars, truncated } = extracted;
  const timeLeft = () => deadline - Date.now();
  try {
    // No budget left for the model at all → deterministic digest, not a 504.
    if (timeLeft() < MIN_DIGEST_MS) throw new Error("no time budget for LLM digest");

    let value: ProjectDigest;
    let partial = false;
    if (totalChars <= FULL_DUMP_MAX_CHARS) {
      const pack = buildPack(meta, languages, files);
      try {
        value = await fullDump(pack, deadline);
      } catch (err) {
        // Only map-reduce if there's time; otherwise the full dump failing on a
        // slow provider means map-reduce would 504 too — go straight to fallback.
        if (timeLeft() < MIN_DIGEST_MS) throw err;
        console.warn("[projectService] full dump failed — falling back to map-reduce:", err);
        ({ value, partial } = await mapReduce(files, meta, languages, deadline));
      }
    } else {
      ({ value, partial } = await mapReduce(files, meta, languages, deadline));
    }
    return renderDigest(withSummary(value, meta), digestNote(meta, truncated || partial)).slice(
      0,
      MAX_DIGEST_CHARS,
    );
  } catch (err) {
    console.warn("[projectService] digest failed — using deterministic fallback:", err);
    return fallbackDigest(meta, files, truncated);
  }
}

// ── Orchestrator ──────────────────────────────────────────────────

export interface ExtractProjectResult {
  digest: string;
  repo: {
    owner: string;
    repo: string;
    ref: string;
    description: string;
    language: string;
    languages: Record<string, number>;
    topics: string[];
    stars: number;
    pushed_at: string;
    file_count: number;
    truncated: boolean;
  };
  chars: number;
}

/**
 * The whole pipeline: parse → meta (size gate) → languages → tarball → extract →
 * digest. Every GitHub URL is built from validated parts inside the helpers; the
 * raw string only ever reaches parseRepoUrl.
 */
export async function extractProject(repoUrl: string): Promise<ExtractProjectResult> {
  // The wall clock the whole extract works to, so a slow provider degrades to
  // the deterministic digest inside maxDuration rather than being 504'd.
  const deadline = Date.now() + ROUTE_BUDGET_MS;
  const { owner, repo, ref, subpath } = parseRepoUrl(repoUrl);

  const meta = await fetchRepoMeta(owner, repo, ref);
  if (meta.size > MAX_REPO_KB) {
    throw badRequest(
      "This repo is too large to import — paste a description instead.",
      "repo_too_large",
    );
  }

  const languages = await fetchLanguages(owner, repo);
  const extracted = await fetchAndExtractTarball(owner, repo, meta.ref, subpath);
  if (extracted.files.length === 0) {
    throw badRequest("This repo looks empty — paste a description instead.", "empty_repo");
  }

  const digest = await digestPack(extracted, meta, languages, deadline);

  return {
    digest,
    repo: {
      owner: meta.owner,
      repo: meta.repo,
      ref: meta.ref,
      description: meta.description,
      language: meta.language,
      languages,
      topics: meta.topics,
      stars: meta.stars,
      pushed_at: meta.pushed_at,
      file_count: extracted.files.length,
      truncated: extracted.truncated,
    },
    chars: digest.length,
  };
}
