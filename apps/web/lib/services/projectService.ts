import "server-only";
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

const MAX_REPO_KB = 200_000;
const GITHUB_TIMEOUT_MS = 10_000;
const EXTRACT_DEADLINE_MS = 20_000;
const MAX_DIGEST_CHARS = 24_000;
const ROUTE_BUDGET_MS = 55_000;
const MIN_DIGEST_MS = 6_000;

export const EXTRACT_CAPS = {
  perEntryBytes: 400 * 1024,
  perFileChars: 25_000,
  maxTotalChars: 4_000_000,
  maxEntries: 20_000,
} as const;

const FULL_DUMP_MAX_CHARS = 700_000;
const CHUNK_CHARS = 90_000;
const MAX_CHUNKS = 24;
const CHUNK_CONCURRENCY = 5;
const MAP_NOTE_CHARS = 4_000;
const DIGEST_TIMEOUT_MS = 90_000;

const GITHUB_API = "https://api.github.com";

export interface ParsedRepo {
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
}

const SEGMENT = /^[\w.-]+$/;

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

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "grill-app",
  };
  if (config.github.token) headers.Authorization = `Bearer ${config.github.token}`;
  return headers;
}

function githubUnavailable(res: Response): AppError {
  const remaining = res.headers.get("x-ratelimit-remaining");
  const detail =
    remaining === "0"
      ? "GitHub's API rate limit is exhausted — try again shortly, or set GITHUB_TOKEN."
      : `GitHub is unavailable right now (status ${res.status}).`;
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
  size: number;
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

function stripRoot(name: string): string {
  const i = name.indexOf("/");
  return i === -1 ? "" : name.slice(i + 1);
}

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
      stream.resume();
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
        if (c.subarray(0, 1024).includes(0)) binary = true;
      }
      if (binary) return;
      if (bytes < caps.perFileChars * 4) {
        chunks.push(c);
        bytes += c.length;
      }
    });

    stream.on("end", () => {
      if (!binary && chunks.length) {
        let text = Buffer.concat(chunks).toString("utf8");
        const truncatedFile = text.length > caps.perFileChars;
        if (truncatedFile) text = text.slice(0, caps.perFileChars);
        state.files.push({ path, text, truncatedFile });
        state.totalChars += text.length;
        if (state.totalChars >= caps.maxTotalChars || state.entryCount >= caps.maxEntries) {
          state.truncated = true;
          opts.abort();
        }
      }
      next();
    });

    stream.on("error", () => next());
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pipeline(Readable.fromWeb(body as any), createGunzip(), extract);
  } catch (err) {
    const expected = state.truncated && (err as Error)?.name === "AbortError";
    if (!expected) throw err;
  }

  sortFiles(state.files);
  return state;
}

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
  if (!res.ok || !res.body) {
    if (res.status === 404) throw notFound("That branch doesn't exist in the repo.", "repo_not_found");
    throw githubUnavailable(res);
  }

  try {
    return await extractRepoTarball(res.body, { subpath, abort: () => controller.abort() });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(502, "github_unavailable", "Couldn't read the repo archive — try again.");
  }
}

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

export function buildPack(
  meta: RepoMeta,
  languages: Record<string, number>,
  files: ExtractedFile[],
): string {
  const body = files.map((f) => `=== ${f.path} ===\n${f.text}`).join("\n\n");
  return `${metaHeader(meta, languages)}\n\n${body}`;
}

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

function withSummary(value: ProjectDigest, meta: RepoMeta): ProjectDigest {
  if (value.summary.trim()) return value;
  return {
    ...value,
    summary:
      meta.description || `${meta.owner}/${meta.repo} — a ${meta.language || "software"} project.`,
  };
}

function callTimeout(deadline: number): number {
  return Math.min(DIGEST_TIMEOUT_MS, Math.max(MIN_DIGEST_MS, deadline - Date.now()));
}

async function fullDump(pack: string, deadline: number): Promise<ProjectDigest> {
  const { value } = await generateJson(projectDigestSchema, {
    system: PROJECT_DIGEST_SYSTEM,
    prompt: pack,
    temperature: 0.4,
    timeoutMs: callTimeout(deadline),
  });
  return value;
}

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

async function digestPack(
  extracted: ExtractResult,
  meta: RepoMeta,
  languages: Record<string, number>,
  deadline: number,
): Promise<string> {
  const { files, totalChars, truncated } = extracted;
  const timeLeft = () => deadline - Date.now();
  try {
    if (timeLeft() < MIN_DIGEST_MS) throw new Error("no time budget for LLM digest");

    let value: ProjectDigest;
    let partial = false;
    if (totalChars <= FULL_DUMP_MAX_CHARS) {
      const pack = buildPack(meta, languages, files);
      try {
        value = await fullDump(pack, deadline);
      } catch (err) {
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

export async function extractProject(repoUrl: string): Promise<ExtractProjectResult> {
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
