import { describe, expect, mock, test } from "bun:test";
import type { TreeEntry } from "./projectService";

// `server-only` is a build-time marker with no runtime behaviour; neutralise it
// before projectService pulls it in via env.ts.
mock.module("server-only", () => ({}));

// env.ts fails fast on a missing key; Bun doesn't load .env.local under
// NODE_ENV=test. Satisfy the boot check and nothing else — no test here reaches
// a network or a provider.
process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";

// The digest-fallback test needs generateJson to throw; every other test here is
// pure and never calls it. One module mock for the whole file (run.ts isolates
// each file in its own process, so this can't leak into another suite).
const generateJson = mock(async () => {
  throw new Error("provider down");
});
mock.module("@/lib/clients/llmJson", () => ({ generateJson }));

const { parseRepoUrl, selectFiles, buildPack, isSkippable, digestRepo, extractProject } =
  await import("./projectService");

// ── parseRepoUrl ──────────────────────────────────────────────────

describe("parseRepoUrl", () => {
  test("plain repo URL", () => {
    expect(parseRepoUrl("https://github.com/YatinDora81/Grill")).toEqual({
      owner: "YatinDora81",
      repo: "Grill",
    });
  });

  test("strips a trailing .git", () => {
    expect(parseRepoUrl("https://github.com/YatinDora81/Grill.git")).toEqual({
      owner: "YatinDora81",
      repo: "Grill",
    });
  });

  test("reads a /tree/{ref} branch", () => {
    expect(parseRepoUrl("https://github.com/YatinDora81/Grill/tree/dev")).toEqual({
      owner: "YatinDora81",
      repo: "Grill",
      ref: "dev",
    });
  });

  test("reads a /tree/{ref}/{subpath} monorepo focus", () => {
    expect(parseRepoUrl("https://github.com/YatinDora81/Grill/tree/main/apps/web")).toEqual({
      owner: "YatinDora81",
      repo: "Grill",
      ref: "main",
      subpath: "apps/web",
    });
  });

  test("accepts www.github.com", () => {
    expect(parseRepoUrl("https://www.github.com/a/b").owner).toBe("a");
  });

  test.each([
    ["a non-github host", "https://gitlab.com/owner/repo"],
    ["a javascript: payload", "javascript:alert(1)//github.com/a/b"],
    // The scheme is github.com's host but not http(s): this is the case that
    // actually exercises the protocol guard, not the payload above (which the
    // host check catches first).
    ["a javascript: scheme with a github host", "javascript://github.com/a/b"],
    ["a non-http scheme on the github host", "ftp://github.com/a/b"],
    ["an internal host", "http://169.254.169.254/latest/meta-data"],
    ["a repo-less URL", "https://github.com/YatinDora81"],
    ["a bare owner path", "https://github.com/"],
    ["a non-tree extra path", "https://github.com/a/b/blob/main/x.ts"],
    // owner/repo/ref are interpolated into request paths, so a disallowed char
    // in any of them must be rejected before it can reach a URL.
    ["an owner with a disallowed char", "https://github.com/a~b/repo"],
    ["a repo with a disallowed char", "https://github.com/owner/re po"],
    ["a ref with a disallowed char", "https://github.com/a/b/tree/foo bar"],
    ["garbage", "not a url at all"],
  ])("rejects %s", (_label, url) => {
    expect(() => parseRepoUrl(url)).toThrow();
  });

  test("the rejection is a 400 bad_repo_url, not a 500", () => {
    try {
      parseRepoUrl("https://gitlab.com/a/b");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number; code: string }).status).toBe(400);
      expect((err as { code: string }).code).toBe("bad_repo_url");
    }
  });
});

// ── selection heuristic ───────────────────────────────────────────

/** A blob entry; size defaults small so it isn't skipped on size. */
function blob(path: string, size = 500): TreeEntry {
  return { path, type: "blob", size };
}

describe("selectFiles", () => {
  test("picks manifests and skips lockfiles", () => {
    const picked = selectFiles([
      blob("package.json"),
      blob("package-lock.json"),
      blob("bun.lockb"),
      blob("go.mod"),
    ]);
    expect(picked).toContain("package.json");
    expect(picked).toContain("go.mod");
    expect(picked).not.toContain("package-lock.json");
    expect(picked).not.toContain("bun.lockb");
  });

  test("skips lockfiles by name — asserted directly, since they're never picked anyway", () => {
    // The .not.toContain checks above can't fail on their own (a lockfile isn't a
    // selection candidate), so pin the skip itself, the way the binary/oversized
    // cases below are pinned.
    expect(isSkippable(blob("package-lock.json"))).toBe(true);
    expect(isSkippable(blob("bun.lockb"))).toBe(true);
    expect(isSkippable(blob("go.sum"))).toBe(true);
    expect(isSkippable(blob("Gemfile.lock"))).toBe(true);
  });

  test("skips node_modules, binaries and oversized blobs", () => {
    expect(isSkippable(blob("node_modules/left-pad/index.js"))).toBe(true);
    expect(isSkippable(blob("dist/bundle.js"))).toBe(true);
    expect(isSkippable(blob("logo.png"))).toBe(true);
    expect(isSkippable(blob("app.min.js"))).toBe(true);
    expect(isSkippable(blob("huge.ts", 300 * 1024))).toBe(true);
    expect(isSkippable(blob("src/app.ts"))).toBe(false);
    // A tree node is never a file to fetch.
    expect(isSkippable({ path: "src", type: "tree" })).toBe(true);
  });

  test("matches skip dirs on whole segments, not substrings", () => {
    // `rebuild/` must not read as `build/`, nor `mytarget/` as `target/` — a
    // substring test drops real source files the candidate should be grilled on.
    expect(isSkippable(blob("src/rebuild/gen.ts"))).toBe(false);
    expect(isSkippable(blob("packages/mytarget/lib.ts"))).toBe(false);
    expect(isSkippable(blob("webpack-build/config.ts"))).toBe(false);
    // ...but a real target/ directory is still skipped.
    expect(isSkippable(blob("target/debug/main.rs"))).toBe(true);
  });

  test("caps at the file budget however many candidates there are", () => {
    const entries = Array.from({ length: 200 }, (_, i) => blob(`src/mod${i}.ts`, 1000 + i));
    const picked = selectFiles(entries);
    expect(picked.length).toBeLessThanOrEqual(25);
  });

  test("a subpath filters the tree to that package before selection", () => {
    const picked = selectFiles(
      [
        blob("apps/web/package.json"),
        blob("apps/web/src/app.ts", 4000),
        blob("apps/api/package.json"),
        blob("apps/api/src/server.ts", 4000),
      ],
      "apps/web",
    );
    expect(picked.every((p) => p.startsWith("apps/web/"))).toBe(true);
    expect(picked).toContain("apps/web/package.json");
  });

  test("prefers the largest source files as representative code", () => {
    const picked = selectFiles([
      blob("src/tiny.ts", 100),
      blob("src/big.ts", 50_000),
      blob("src/medium.ts", 5_000),
    ]);
    // All three fit under the budget, but big must be picked.
    expect(picked).toContain("src/big.ts");
  });
});

// ── pack builder ──────────────────────────────────────────────────

const META = {
  owner: "YatinDora81",
  repo: "Grill",
  ref: "main",
  description: "A mock-interview grill",
  language: "TypeScript",
  topics: ["interviews", "ai"],
  stars: 12,
  size: 400,
  fork: false,
  parent: null,
  pushed_at: "2026-07-01T00:00:00Z",
};

describe("buildPack", () => {
  test("stays under the total budget even with oversized files", () => {
    const files = Array.from({ length: 25 }, (_, i) => ({
      path: `src/mod${i}.ts`,
      content: "x".repeat(20_000),
    }));
    const pack = buildPack({
      meta: META,
      languages: { TypeScript: 10_000 },
      entries: files.map((f) => blob(f.path)),
      readme: "y".repeat(20_000),
      files,
      truncated: false,
    });
    expect(pack.length).toBeLessThanOrEqual(70_000);
    expect(pack).toContain("Repository: YatinDora81/Grill");
    expect(pack).toContain("=== file tree ===");
  });

  test("drops whole file blocks at the budget rather than truncating one mid-way", () => {
    // Each file's content is bracketed START-i … END-i, small enough to survive
    // the per-file excerpt whole. A blind final `.slice()` would cut the boundary
    // block, leaving a START with no END; atomic per-block budgeting never does.
    const files = Array.from({ length: 30 }, (_, i) => ({
      path: `src/mod${i}.ts`,
      content: `START-${i} ${"x".repeat(4_000)} END-${i}`,
    }));
    const pack = buildPack({
      meta: META,
      languages: {},
      entries: files.map((f) => blob(f.path)),
      readme: "",
      files,
      truncated: false,
    });
    expect(pack.length).toBeLessThanOrEqual(70_000);
    // The sum far exceeds the budget, so some blocks are dropped...
    const starts = (pack.match(/START-/g) ?? []).length;
    expect(starts).toBeLessThan(30);
    expect(starts).toBeGreaterThan(0);
    // ...but every block that made it in is whole — no orphaned START.
    const ends = (pack.match(/END-/g) ?? []).length;
    expect(ends).toBe(starts);
  });

  test("flags a fork and a truncated tree in the head", () => {
    const pack = buildPack({
      meta: { ...META, fork: true, parent: "someone/original" },
      languages: {},
      entries: [blob("README.md")],
      readme: "hi",
      files: [],
      truncated: true,
    });
    expect(pack).toContain("fork of someone/original");
    expect(pack).toContain("truncated");
  });
});

// ── digest fallback ───────────────────────────────────────────────

describe("digestRepo fallback", () => {
  test("returns a deterministic digest when the LLM throws, never dies", async () => {
    const digest = await digestRepo("=== file tree ===\nsrc/app.ts", META, false);
    // The description seeds the fallback summary, and the raw pack is appended so
    // the user still has real material to edit.
    expect(digest).toContain("A mock-interview grill");
    expect(digest).toContain("raw repo pack");
    expect(generateJson).toHaveBeenCalled();
  });

  test("carries the fork note into the fallback digest", async () => {
    const digest = await digestRepo("pack", { ...META, fork: true, parent: "up/stream" }, false);
    expect(digest).toContain("fork of up/stream");
  });
});

// ── GitHub error mapping ──────────────────────────────────────────

describe("extractProject maps GitHub failures to human errors", () => {
  const realFetch = globalThis.fetch;
  /** Route by path suffix; each test supplies only the responses it reaches. */
  function mockGitHub(routes: { meta?: Response; tree?: Response }) {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/git/trees/")) return routes.tree ?? new Response("{}", { status: 500 });
      if (/\/repos\/[^/]+\/[^/]+$/.test(u.split("?")[0]!)) {
        return routes.meta ?? new Response("{}", { status: 500 });
      }
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
  }
  // Restore between cases; run.ts isolates the file, but not the tests in it.
  const restore = () => {
    globalThis.fetch = realFetch;
  };

  test("a 404 on the repo is repo_not_found, not a 500", async () => {
    mockGitHub({ meta: new Response("Not Found", { status: 404 }) });
    try {
      await extractProject("https://github.com/ghost/missing");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number; code: string }).status).toBe(404);
      expect((err as { code: string }).code).toBe("repo_not_found");
    } finally {
      restore();
    }
  });

  test("a repo whose tree has no blobs is empty_repo", async () => {
    mockGitHub({
      meta: new Response(JSON.stringify({ default_branch: "main" }), { status: 200 }),
      tree: new Response(JSON.stringify({ tree: [], truncated: false }), { status: 200 }),
    });
    try {
      await extractProject("https://github.com/owner/empty");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number; code: string }).status).toBe(400);
      expect((err as { code: string }).code).toBe("empty_repo");
    } finally {
      restore();
    }
  });

  test("a GitHub 5xx is github_unavailable (502) and leaks nothing", async () => {
    mockGitHub({ meta: new Response("upstream boom", { status: 503 }) });
    try {
      await extractProject("https://github.com/owner/repo");
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as { status: number; code: string; message: string };
      expect(e.status).toBe(502);
      expect(e.code).toBe("github_unavailable");
      // The provider's own body (and any auth detail) never reaches the message.
      expect(e.message).not.toContain("upstream boom");
      expect(e.message.toLowerCase()).not.toContain("bearer");
    } finally {
      restore();
    }
  });

  test("an exhausted rate limit says so", async () => {
    mockGitHub({
      meta: new Response("rate limited", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      }),
    });
    try {
      await extractProject("https://github.com/owner/repo");
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as { status: number; code: string; message: string };
      expect(e.status).toBe(502);
      expect(e.code).toBe("github_unavailable");
      expect(e.message.toLowerCase()).toContain("rate limit");
    } finally {
      restore();
    }
  });
});
