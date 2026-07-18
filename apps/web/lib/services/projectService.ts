import "server-only";
/**
 * GitHub repo → interviewer digest, run ONCE at creation time.
 *
 * Mirrors resumeService: the expensive ingestion (here ~30 GitHub calls + one
 * LLM pass) happens once in the extract endpoint, and /start only ever takes the
 * resulting text. The interview never talks to GitHub.
 *
 * Two-stage pipeline: a deterministic repo pack (no LLM), then one LLM digest
 * pass that compresses it to something cheap to re-send every turn.
 *
 * SECURITY (§8): the raw user string is NEVER fetched. We parse owner/repo/ref
 * out of it, validate each part, and build every request URL from those parts
 * against the api.github.com literal. Budgets are the DoS defence — a 10 GB repo
 * costs the same as a small one because entries are filtered by blob size before
 * anything is fetched.
 */
import { config } from "@/lib/env";
import { AppError, badRequest, notFound } from "@/lib/errors";
import { generateJson } from "@/lib/clients/llmJson";
import {
  PROJECT_DIGEST_SYSTEM,
  projectDigestSchema,
  renderDigest,
  type ProjectDigest,
} from "@/lib/prompts/projectDigest";

// ── Budgets (tune later) ──────────────────────────────────────────
const MAX_FILES_FETCHED = 25;
const PER_FILE_CHARS = 6_000;
const TOTAL_PACK_CHARS = 70_000;
/** A blob bigger than this is skipped before it is ever fetched. */
const MAX_BLOB_BYTES = 200 * 1024;
/** Representative code excerpts are the first ~200 lines only. */
const CODE_EXCERPT_LINES = 200;
/** The rendered digest the textarea shows is capped to the schema's field max. */
const MAX_DIGEST_CHARS = 24_000;
/** GitHub is fast; a hung call must not hold the request open for 30s. */
const GITHUB_TIMEOUT_MS = 15_000;

const GITHUB_API = "https://api.github.com";

// ── URL parsing (§7) ──────────────────────────────────────────────

export interface ParsedRepo {
  owner: string;
  repo: string;
  /** Branch/ref, when the URL named one via /tree/{ref}. */
  ref?: string;
  /** Monorepo focus hint — the tree is filtered to this prefix before selection. */
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
  // Protocol AND host are checked explicitly: `javascript:` parses, and only
  // github.com (or www.) is ever contacted.
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

  // /tree/{ref} and /tree/{ref}/{subpath...}. Anything else after repo that
  // isn't a /tree/ is not a shape we claim to handle.
  if (segs.length >= 4 && segs[2] === "tree") {
    const ref = segs[3]!;
    if (!SEGMENT.test(ref)) {
      throw badRequest("That branch name isn't valid.", "bad_repo_url");
    }
    parsed.ref = ref;
    const rest = segs.slice(4);
    if (rest.length) {
      // Subpath segments are joined for the tree filter only; they are never
      // used to build a request URL, but validate them anyway.
      if (!rest.every((s) => SEGMENT.test(s))) {
        throw badRequest("That path in the URL isn't valid.", "bad_repo_url");
      }
      parsed.subpath = rest.join("/");
    }
  } else if (segs.length > 2) {
    throw badRequest("Link the repository itself, or a branch: github.com/owner/repo.", "bad_repo_url");
  }

  return parsed;
}

// ── GitHub client ─────────────────────────────────────────────────

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

interface GhFetchOpts {
  /** Request raw file bytes rather than the JSON envelope. */
  raw?: boolean;
  /** 404 is expected for this call (repo/ref existence) — let the caller handle it. */
  allow404?: boolean;
}

/**
 * One host, one auth path. `path` is always built from validated parts by the
 * callers below — never from the raw user string.
 */
async function ghFetch(path: string, opts: GhFetchOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: opts.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "grill-app",
  };
  if (config.github.token) headers.Authorization = `Bearer ${config.github.token}`;

  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      headers,
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch {
    // Network error / timeout. No provider detail to leak.
    throw new AppError(502, "github_unavailable", "Couldn't reach GitHub — try again shortly.");
  }
  if (res.ok) return res;
  if (res.status === 404 && opts.allow404) return res;
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
  const res = await ghFetch(`/repos/${owner}/${repo}`, { allow404: true });
  if (res.status === 404) {
    throw notFound(
      "Repo not found — private repos aren't supported yet. Make it public or paste a description instead.",
      "repo_not_found",
    );
  }
  const d = (await res.json()) as {
    default_branch?: string;
    description?: string | null;
    language?: string | null;
    topics?: string[];
    stargazers_count?: number;
    size?: number;
    fork?: boolean;
    parent?: { full_name?: string } | null;
    pushed_at?: string;
  };
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

export interface TreeEntry {
  path: string;
  type: string; // "blob" | "tree" | "commit"
  size?: number;
}

async function fetchTree(
  owner: string,
  repo: string,
  ref: string,
): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const res = await ghFetch(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { allow404: true },
  );
  if (res.status === 404) {
    // The repo exists (meta succeeded) but this ref doesn't.
    throw notFound("That branch doesn't exist in the repo.", "repo_not_found");
  }
  const d = (await res.json()) as {
    tree?: { path?: string; type?: string; size?: number }[];
    truncated?: boolean;
  };
  const entries: TreeEntry[] = (d.tree ?? [])
    .filter((e): e is { path: string; type: string; size?: number } => Boolean(e.path && e.type))
    .map((e) => ({ path: e.path, type: e.type, size: e.size }));
  return { entries, truncated: Boolean(d.truncated) };
}

async function fetchLanguages(owner: string, repo: string): Promise<Record<string, number>> {
  const res = await ghFetch(`/repos/${owner}/${repo}/languages`, { allow404: true });
  if (!res.ok) return {};
  return (await res.json()) as Record<string, number>;
}

async function fetchReadme(owner: string, repo: string, ref: string): Promise<string> {
  const res = await ghFetch(`/repos/${owner}/${repo}/readme?ref=${encodeURIComponent(ref)}`, {
    raw: true,
    allow404: true,
  });
  if (!res.ok) return "";
  return (await res.text()).slice(0, PER_FILE_CHARS);
}

async function fetchRawFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  // The path comes from the tree GitHub itself returned, not the user; still,
  // encode each segment so a path can only ever be a path.
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const res = await ghFetch(
    `/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
    { raw: true, allow404: true },
  );
  if (!res.ok) return null;
  return await res.text();
}

// ── File selection heuristic (§3A) — pure ─────────────────────────

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "poetry.lock",
  "gemfile.lock",
  "composer.lock",
  "go.sum",
]);

/** Matched against whole path SEGMENTS — `rebuild/` must not count as `build/`. */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "vendor", ".git", ".next", "target"]);

/** Binaries, images, fonts, media — nothing an interviewer reads. */
const SKIP_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "bmp", "tiff",
  "mp4", "mov", "avi", "webm", "mp3", "wav", "flac", "ogg",
  "pdf", "zip", "gz", "tar", "tgz", "rar", "7z",
  "woff", "woff2", "ttf", "eot", "otf",
  "bin", "exe", "dll", "so", "dylib", "class", "jar", "wasm", "o", "a",
  "lock", "map", "snap",
]);

const MANIFEST_NAMES = new Set([
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
]);

const INFRA_NAMES = new Set(["docker-compose.yml", "docker-compose.yaml", "vercel.json", "fly.toml"]);

/** Extensions worth reading as representative code. */
const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "go", "rs", "java", "kt", "rb", "php", "cs",
  "c", "cc", "cpp", "h", "hpp", "swift", "scala", "ex", "exs", "clj",
  "vue", "svelte",
]);

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function extname(path: string): string {
  const b = basename(path);
  const dot = b.lastIndexOf(".");
  return dot === -1 ? "" : b.slice(dot + 1).toLowerCase();
}

/** True for anything that must never be fetched, whatever its priority. */
export function isSkippable(entry: TreeEntry): boolean {
  if (entry.type !== "blob") return true;
  const path = entry.path;
  const lower = path.toLowerCase();
  const base = basename(lower);
  if (LOCKFILES.has(base)) return true;
  // Directory segments only (drop the filename): a substring test would skip
  // `src/rebuild/gen.ts` because "rebuild/".includes("build/").
  if (lower.split("/").slice(0, -1).some((seg) => SKIP_DIRS.has(seg))) return true;
  if (base.includes(".min.")) return true;
  if (SKIP_EXT.has(extname(lower))) return true;
  if (typeof entry.size === "number" && entry.size > MAX_BLOB_BYTES) return true;
  return false;
}

function isManifest(path: string): boolean {
  const base = basename(path).toLowerCase();
  return MANIFEST_NAMES.has(base) || base.endsWith(".csproj");
}

function isInfra(path: string): boolean {
  const base = basename(path).toLowerCase();
  return INFRA_NAMES.has(base) || base.startsWith("dockerfile");
}

function isSchemaOrApi(path: string): boolean {
  const base = basename(path).toLowerCase();
  return (
    base === "schema.prisma" ||
    base === "openapi.json" ||
    base === "openapi.yaml" ||
    base === "openapi.yml" ||
    base === "swagger.json" ||
    base === "swagger.yaml" ||
    base === "swagger.yml"
  );
}

function isEntrypoint(path: string): boolean {
  const lower = path.toLowerCase();
  const base = basename(lower);
  return (
    /^src\/index\.[a-z]+$/.test(lower) ||
    /^src\/main\.[a-z]+$/.test(lower) ||
    lower === "app/main.py" ||
    (lower.startsWith("cmd/") && base === "main.go") ||
    /^next\.config\.[a-z]+$/.test(lower)
  );
}

/**
 * Walk the tree once and pick files to fetch in priority order until the file
 * budget is hit: manifests, infra, schema/API, entrypoints, then the largest
 * remaining source files. A subpath filters the tree to a monorepo package
 * first, so `…/tree/main/apps/web` interviews on the web app specifically.
 */
export function selectFiles(entries: TreeEntry[], subpath?: string): string[] {
  const prefix = subpath ? (subpath.endsWith("/") ? subpath : `${subpath}/`) : "";
  const usable = entries.filter(
    (e) => !isSkippable(e) && (!prefix || e.path === subpath || e.path.startsWith(prefix)),
  );

  const picked: string[] = [];
  const seen = new Set<string>();
  const add = (path: string) => {
    if (seen.has(path) || picked.length >= MAX_FILES_FETCHED) return;
    seen.add(path);
    picked.push(path);
  };

  for (const e of usable) if (isManifest(e.path)) add(e.path);
  for (const e of usable) if (isInfra(e.path)) add(e.path);
  for (const e of usable) if (isSchemaOrApi(e.path)) add(e.path);
  // First couple of raw SQL files — migrations themselves stay names-only.
  let sql = 0;
  for (const e of usable) {
    if (extname(e.path) === "sql" && !e.path.toLowerCase().includes("migration") && sql < 2) {
      add(e.path);
      sql++;
    }
  }
  for (const e of usable) if (isEntrypoint(e.path)) add(e.path);

  // Representative code: the largest remaining source files.
  const code = usable
    .filter((e) => CODE_EXT.has(extname(e.path)) && !seen.has(e.path))
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
    .slice(0, 5);
  for (const e of code) add(e.path);

  return picked;
}

// ── Pack builder (§3A) — pure ─────────────────────────────────────

/** Trim one file excerpt to the first ~200 lines and the per-file char cap. */
function excerpt(content: string): string {
  const byLines = content.split("\n").slice(0, CODE_EXCERPT_LINES).join("\n");
  return byLines.slice(0, PER_FILE_CHARS);
}

/** Top-level dirs and a file-count-by-extension summary — the map of the repo. */
function treeSummary(entries: TreeEntry[]): string {
  const blobs = entries.filter((e) => e.type === "blob");
  const topDirs = new Set<string>();
  const byExt = new Map<string, number>();
  for (const e of blobs) {
    const slash = e.path.indexOf("/");
    if (slash !== -1) topDirs.add(e.path.slice(0, slash) + "/");
    const ext = extname(e.path) || "(no ext)";
    byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
  }
  const dirs = [...topDirs].sort().join(", ") || "(flat repo)";
  const exts = [...byExt.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([ext, n]) => `${ext}:${n}`)
    .join(", ");
  return `Top-level: ${dirs}\nFiles by type: ${exts}\nTotal files: ${blobs.length}`;
}

export interface PackInput {
  meta: RepoMeta;
  languages: Record<string, number>;
  entries: TreeEntry[];
  readme: string;
  files: { path: string; content: string }[];
  truncated: boolean;
}

/**
 * Assemble the repo pack: metadata + language table + tree summary + README +
 * selected file excerpts, each under a `=== path ===` header, hard-capped at
 * TOTAL_PACK_CHARS so a huge repo can't blow the digest call's input.
 */
export function buildPack(input: PackInput): string {
  const { meta, languages, entries, readme, files, truncated } = input;
  const langLine =
    Object.entries(languages)
      .sort((a, b) => b[1] - a[1])
      .map(([lang, bytes]) => `${lang} (${bytes})`)
      .join(", ") || meta.language || "(unknown)";

  const head = [
    `Repository: ${meta.owner}/${meta.repo}`,
    meta.description && `Description: ${meta.description}`,
    meta.topics.length && `Topics: ${meta.topics.join(", ")}`,
    `Primary language: ${meta.language || "(unknown)"} · Stars: ${meta.stars} · Last push: ${meta.pushed_at || "(unknown)"}`,
    meta.fork && `NOTE: this repo is a fork of ${meta.parent ?? "another repo"}.`,
    truncated && "NOTE: the file tree was truncated by GitHub — this is a partial view.",
    `Languages: ${langLine}`,
    "",
    "=== file tree ===",
    treeSummary(entries),
  ]
    .filter(Boolean)
    .join("\n");

  const sections: string[] = [head];
  let used = head.length;

  const push = (header: string, body: string) => {
    if (!body.trim()) return;
    const block = `\n\n=== ${header} ===\n${body}`;
    if (used + block.length > TOTAL_PACK_CHARS) return;
    sections.push(block);
    used += block.length;
  };

  if (readme) push("README", readme.slice(0, PER_FILE_CHARS));
  for (const f of files) push(f.path, excerpt(f.content));

  return sections.join("").slice(0, TOTAL_PACK_CHARS);
}

// ── Stage B: LLM digest, with deterministic fallback (§3B) ────────

/** The honesty line that rides at the top of the digest (fork / truncation). */
function digestNote(meta: RepoMeta, truncated: boolean): string {
  const notes: string[] = [];
  if (meta.fork) notes.push(`Note: this repo is a fork of ${meta.parent ?? "another repo"}.`);
  if (truncated) {
    notes.push(
      "Note: this is a large repo — only a partial view was imported. Edit the summary to add anything missing.",
    );
  }
  return notes.join("\n");
}

/**
 * When the LLM call fails after its retries, a metadata-only digest is still
 * better than a dead request — the user can edit it anyway. Deterministic, no
 * model.
 */
function fallbackDigest(pack: string, meta: RepoMeta, note: string): string {
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
  // Append the raw pack head (README + metadata already in it) so the user has
  // real material to edit even without the model.
  const rendered = renderDigest(digest, note);
  return `${rendered}\n\n=== raw repo pack (unsummarised) ===\n${pack}`.slice(0, MAX_DIGEST_CHARS);
}

export async function digestRepo(pack: string, meta: RepoMeta, truncated: boolean): Promise<string> {
  const note = digestNote(meta, truncated);
  try {
    const { value } = await generateJson(projectDigestSchema, {
      system: PROJECT_DIGEST_SYSTEM,
      prompt: `Repo pack:\n\n${pack}`,
      temperature: 0.4,
    });
    return renderDigest(value, note).slice(0, MAX_DIGEST_CHARS);
  } catch (err) {
    console.warn("[projectService] digest LLM failed — using deterministic fallback:", err);
    return fallbackDigest(pack, meta, note);
  }
}

// ── Orchestrator ──────────────────────────────────────────────────

export interface ExtractResult {
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
 * The whole pipeline: parse → repo meta → tree → select → fetch excerpts →
 * pack → digest. Every GitHub URL is built from validated parts inside the
 * helpers above; the raw string only ever reaches parseRepoUrl.
 */
export async function extractProject(repoUrl: string): Promise<ExtractResult> {
  const { owner, repo, ref, subpath } = parseRepoUrl(repoUrl);

  const meta = await fetchRepoMeta(owner, repo, ref);
  const { entries, truncated } = await fetchTree(owner, repo, meta.ref);
  if (entries.filter((e) => e.type === "blob").length === 0) {
    throw badRequest("This repo looks empty — paste a description instead.", "empty_repo");
  }

  const selected = selectFiles(entries, subpath);
  const [languages, readme, ...contents] = await Promise.all([
    fetchLanguages(owner, repo),
    fetchReadme(owner, repo, meta.ref),
    ...selected.map((path) => fetchRawFile(owner, repo, path, meta.ref)),
  ]);

  const files = selected
    .map((path, i) => ({ path, content: contents[i] ?? null }))
    .filter((f): f is { path: string; content: string } => f.content !== null);

  if (!readme && files.length === 0) {
    throw badRequest(
      "Couldn't read any usable files from this repo — paste a description instead.",
      "empty_repo",
    );
  }

  const pack = buildPack({ meta, languages, entries, readme, files, truncated });
  const digest = await digestRepo(pack, meta, truncated);

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
      file_count: entries.filter((e) => e.type === "blob").length,
      truncated,
    },
    chars: digest.length,
  };
}
