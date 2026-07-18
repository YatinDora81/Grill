import { beforeEach, describe, expect, mock, test } from "bun:test";
import tar from "tar-stream";
import { createGzip } from "node:zlib";

// `server-only` is a build-time marker with no runtime behaviour; neutralise it
// before projectService pulls it in via env.ts.
mock.module("server-only", () => ({}));

// env.ts fails fast on a missing key; Bun doesn't load .env.local under
// NODE_ENV=test. Satisfy the boot check; fetch and the LLM are mocked below.
process.env.GEMINI_API_KEYS ||= "TEST__SPLIT__not-a-real-key";
process.env.JWT_SECRET ||= "test-secret";
process.env.GITHUB_TOKEN ||= "test-token";

// generateText is the MAP phase (plain text); generateJson is full-dump / merge.
// Both default to throwing; success tests override with mockImplementation.
const THROW_IMPL = async () => {
  throw new Error("provider down");
};
const generateJson = mock(THROW_IMPL);
const generateText = mock(THROW_IMPL);
mock.module("@/lib/clients/llmJson", () => ({ generateJson }));
mock.module("@/lib/clients/llmClient", () => ({ generateText, extractJson: (t: string) => t }));

const {
  parseRepoUrl,
  extractRepoTarball,
  chunkFiles,
  buildPack,
  fallbackDigest,
  extractProject,
  EXTRACT_CAPS,
} = await import("./projectService");
import type { ExtractedFile, RepoMeta } from "./projectService";

// ── fixtures: tar-stream packs as well as it parses, so no binary in git ──

type Entry = string | Buffer | { type: "symlink"; linkname: string } | { type: "directory" };

async function tarball(entries: Record<string, Entry>, root = "owner-repo-abc123"): Promise<Buffer> {
  const pack = tar.pack();
  for (const [name, data] of Object.entries(entries)) {
    if (typeof data === "object" && !Buffer.isBuffer(data)) {
      if (data.type === "symlink") {
        pack.entry({ name: `${root}/${name}`, type: "symlink", linkname: data.linkname });
      } else {
        pack.entry({ name: `${root}/${name}`, type: "directory" });
      }
    } else {
      pack.entry({ name: `${root}/${name}` }, data);
    }
  }
  pack.finalize();
  const gz: Buffer[] = [];
  for await (const c of pack.pipe(createGzip())) gz.push(c as Buffer);
  return Buffer.concat(gz);
}

/** A Buffer as a web ReadableStream, the way fetch would hand it over. */
const webStream = (buf: Buffer): ReadableStream<Uint8Array> => new Response(buf).body!;

const extractBuf = (buf: Buffer, opts: { subpath?: string; abort?: () => void; caps?: typeof EXTRACT_CAPS } = {}) =>
  extractRepoTarball(webStream(buf), { abort: opts.abort ?? (() => {}), subpath: opts.subpath, caps: opts.caps });

const paths = (r: { files: ExtractedFile[] }) => r.files.map((f) => f.path);

// ── parseRepoUrl ──────────────────────────────────────────────────

describe("parseRepoUrl", () => {
  test("plain, .git, /tree/{ref}, /tree/{ref}/{subpath}", () => {
    expect(parseRepoUrl("https://github.com/YatinDora81/Grill")).toEqual({ owner: "YatinDora81", repo: "Grill" });
    expect(parseRepoUrl("https://github.com/a/b.git")).toEqual({ owner: "a", repo: "b" });
    expect(parseRepoUrl("https://github.com/a/b/tree/dev")).toEqual({ owner: "a", repo: "b", ref: "dev" });
    expect(parseRepoUrl("https://github.com/a/b/tree/main/apps/web")).toEqual({
      owner: "a",
      repo: "b",
      ref: "main",
      subpath: "apps/web",
    });
    expect(parseRepoUrl("https://www.github.com/a/b").owner).toBe("a");
  });

  test.each([
    ["a non-github host", "https://gitlab.com/a/b"],
    ["a javascript: payload", "javascript:alert(1)//github.com/a/b"],
    ["a javascript: scheme with a github host", "javascript://github.com/a/b"],
    ["a non-http scheme on the github host", "ftp://github.com/a/b"],
    ["an internal host", "http://169.254.169.254/latest/meta-data"],
    ["a repo-less URL", "https://github.com/YatinDora81"],
    ["a non-tree extra path", "https://github.com/a/b/blob/main/x.ts"],
    ["an owner with a disallowed char", "https://github.com/a~b/repo"],
    ["a ref with a disallowed char", "https://github.com/a/b/tree/foo bar"],
    ["garbage", "not a url at all"],
  ])("rejects %s", (_label, url) => {
    expect(() => parseRepoUrl(url)).toThrow();
  });

  test("rejection is a 400 bad_repo_url", () => {
    try {
      parseRepoUrl("https://gitlab.com/a/b");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number; code: string }).status).toBe(400);
      expect((err as { code: string }).code).toBe("bad_repo_url");
    }
  });
});

// ── streaming tarball extraction ──────────────────────────────────

describe("extractRepoTarball", () => {
  test(
    "strips the GitHub root prefix from every path",
    async () => {
      const r = await extractBuf(await tarball({ "src/a.ts": "export const a = 1;" }));
      expect(paths(r)).toEqual(["src/a.ts"]);
    },
    2000,
  );

  test(
    "enforces the skip-list: lockfiles, node_modules, binaries",
    async () => {
      const r = await extractBuf(
        await tarball({
          "src/keep.ts": "keep me",
          "node_modules/x.js": "junk",
          "bun.lock": "lock",
          "package-lock.json": "lock",
          "logo.png": "img",
          "dist/out.js": "built",
        }),
      );
      expect(paths(r)).toEqual(["src/keep.ts"]);
    },
    2000,
  );

  test(
    "drops a NUL-containing file even with a text extension",
    async () => {
      const withNul = Buffer.concat([Buffer.from("prefix"), Buffer.from([0]), Buffer.from("rest")]);
      const r = await extractBuf(await tarball({ "a.ts": withNul, "b.ts": "clean text" }));
      expect(paths(r)).toEqual(["b.ts"]);
    },
    2000,
  );

  test(
    "caps a big file to perFileChars, marks it, and still drains the tail",
    async () => {
      const caps = { ...EXTRACT_CAPS, perFileChars: 1_000 };
      const r = await extractBuf(
        await tarball({ "big.ts": "x".repeat(100_000), "after.ts": "I come after the big one" }),
        { caps },
      );
      const big = r.files.find((f) => f.path === "big.ts")!;
      expect(big.text.length).toBe(1_000);
      expect(big.truncatedFile).toBe(true);
      // The entry after the capped one still extracted — proof the tail drained.
      expect(paths(r)).toContain("after.ts");
    },
    2000,
  );

  test(
    "hits the global cap: truncated, abort called once, resolves (no reject)",
    async () => {
      const abort = mock(() => {});
      const caps = { ...EXTRACT_CAPS, maxTotalChars: 100 };
      const r = await extractBuf(
        await tarball({ "a.ts": "x".repeat(500), "b.ts": "y".repeat(500), "c.ts": "z".repeat(500) }),
        { caps, abort },
      );
      expect(r.truncated).toBe(true);
      expect(abort.mock.calls.length).toBe(1);
      expect(r.files.length).toBeGreaterThanOrEqual(1);
    },
    2000,
  );

  test(
    "a subpath filters entries to that package",
    async () => {
      const r = await extractBuf(
        await tarball({ "apps/web/x.ts": "web", "apps/audio/y.py": "audio", "root.ts": "root" }),
        { subpath: "apps/web" },
      );
      expect(paths(r)).toEqual(["apps/web/x.ts"]);
    },
    2000,
  );

  test(
    "skips symlink entries",
    async () => {
      const r = await extractBuf(
        await tarball({ "real.ts": "real", evil: { type: "symlink", linkname: "../../etc/passwd" } }),
      );
      expect(paths(r)).toEqual(["real.ts"]);
    },
    2000,
  );

  test(
    "skips directory entries",
    async () => {
      const r = await extractBuf(await tarball({ src: { type: "directory" }, "src/a.ts": "code" }));
      expect(paths(r)).toEqual(["src/a.ts"]);
    },
    2000,
  );

  test(
    "rejects a file whose stripped path traverses upward (zip-slip)",
    async () => {
      // `owner-repo-abc123/../../etc/passwd` → stripRoot → `../../etc/passwd`.
      const r = await extractBuf(await tarball({ "../../etc/passwd": "secret", "ok.ts": "fine" }));
      expect(paths(r)).toEqual(["ok.ts"]);
    },
    2000,
  );

  test(
    "anchors the subpath on a segment boundary, not a bare prefix",
    async () => {
      const r = await extractBuf(
        await tarball({
          "apps/web/x.ts": "web",
          "apps/website/z.ts": "adjacent prefix — must NOT match apps/web",
          "apps/audio/y.py": "audio",
          "root.ts": "root",
        }),
        { subpath: "apps/web" },
      );
      expect(paths(r)).toEqual(["apps/web/x.ts"]);
    },
    2000,
  );

  test(
    "rejects corrupt gzip input instead of hanging",
    async () => {
      const buf = await tarball({ "a.ts": "hello" });
      const corrupt = buf.subarray(0, buf.length - 50);
      await expect(extractBuf(corrupt)).rejects.toThrow();
    },
    2000,
  );

  test(
    "an empty (root-only) tarball yields no files",
    async () => {
      const r = await extractBuf(await tarball({}));
      expect(r.files).toEqual([]);
    },
    2000,
  );

  test(
    "sorts README first, then manifests, then path order",
    async () => {
      const r = await extractBuf(
        await tarball({ "src/z.ts": "z", "package.json": "{}", "README.md": "# hi", "src/a.ts": "a" }),
      );
      expect(paths(r)).toEqual(["README.md", "package.json", "src/a.ts", "src/z.ts"]);
    },
    2000,
  );
});

// ── chunkFiles & buildPack ────────────────────────────────────────

const META: RepoMeta = {
  owner: "YatinDora81",
  repo: "Grill",
  ref: "main",
  description: "A mock-interview grill",
  language: "TypeScript",
  topics: ["ai"],
  stars: 12,
  size: 400,
  fork: false,
  parent: null,
  pushed_at: "2026-07-01T00:00:00Z",
};

describe("chunkFiles", () => {
  test("splits into multiple chunks once content exceeds the chunk budget", () => {
    const files: ExtractedFile[] = Array.from({ length: 20 }, (_, i) => ({
      path: `src/mod${i}.ts`,
      text: "x".repeat(10_000),
      truncatedFile: false,
    }));
    const chunks = chunkFiles(files);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("=== src/mod0.ts ===");
  });

  test("keeps a small repo to a single chunk", () => {
    expect(chunkFiles([{ path: "a.ts", text: "small", truncatedFile: false }]).length).toBe(1);
    expect(chunkFiles([]).length).toBe(0);
  });
});

describe("buildPack", () => {
  test("leads with repo metadata, then each file under a header", () => {
    const pack = buildPack(META, { TypeScript: 100 }, [
      { path: "README.md", text: "# hi", truncatedFile: false },
      { path: "src/a.ts", text: "const a = 1", truncatedFile: false },
    ]);
    expect(pack).toContain("Repository: YatinDora81/Grill");
    expect(pack).toContain("=== README.md ===");
    expect(pack).toContain("=== src/a.ts ===");
  });

  test("flags a fork in the header", () => {
    const pack = buildPack({ ...META, fork: true, parent: "up/stream" }, {}, []);
    expect(pack).toContain("fork of up/stream");
  });
});

// ── fallbackDigest ────────────────────────────────────────────────

describe("fallbackDigest", () => {
  test("seeds the summary from the description and lists files", () => {
    const digest = fallbackDigest(
      META,
      [{ path: "src/app.ts", text: "code", truncatedFile: false }],
      false,
    );
    expect(digest).toContain("A mock-interview grill");
    expect(digest).toContain("raw repo pack");
    expect(digest).toContain("- src/app.ts");
  });

  test("carries the fork note", () => {
    const digest = fallbackDigest({ ...META, fork: true, parent: "up/stream" }, [], false);
    expect(digest).toContain("fork of up/stream");
  });
});

// ── extractProject: fetch + LLM mocked end to end ─────────────────

describe("extractProject", () => {
  const realFetch = globalThis.fetch;
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });

  const REDUCE_VALUE = {
    value: {
      summary: "SUM: a collaborative drawing app.",
      tech_stack: ["TypeScript"],
      architecture: "",
      key_features: [],
      data_and_apis: "",
      notable_decisions: [],
      risks_and_gaps: [],
      question_seeds: [],
    },
    raw: "",
  };

  function mockGitHub(opts: {
    tarball?: Buffer;
    metaStatus?: number;
    tarballStatus?: number;
    meta?: Record<string, unknown>;
    languages?: Record<string, number>;
  }) {
    const meta = {
      default_branch: "main",
      description: "A mock repo",
      language: "TypeScript",
      stargazers_count: 3,
      topics: [],
      size: 1_000,
      ...opts.meta,
    };
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const p = String(url).replace("https://api.github.com", "").split("?")[0]!;
      if (p.includes("/tarball/")) {
        if (opts.tarballStatus && opts.tarballStatus !== 200)
          return new Response("nope", { status: opts.tarballStatus });
        return new Response(opts.tarball ?? Buffer.alloc(0));
      }
      if (p.endsWith("/languages")) return json(opts.languages ?? { TypeScript: 5000 });
      if (/^\/repos\/[^/]+\/[^/]+$/.test(p)) {
        if (opts.metaStatus && opts.metaStatus !== 200)
          return new Response("nope", { status: opts.metaStatus });
        return json(meta);
      }
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
  }
  const restore = () => {
    globalThis.fetch = realFetch;
    generateJson.mockImplementation(THROW_IMPL);
    generateText.mockImplementation(THROW_IMPL);
  };
  beforeEach(() => {
    generateJson.mockClear();
    generateText.mockClear();
  });

  test("a repo that fits one call is a single full-dump digest", async () => {
    mockGitHub({ tarball: await tarball({ "src/a.ts": "code here", "README.md": "# hi" }) });
    generateJson.mockImplementation(async () => REDUCE_VALUE);
    try {
      const res = await extractProject("https://github.com/owner/repo");
      expect(res.digest).toContain("SUM: a collaborative drawing app.");
      expect(res.digest).not.toContain("raw repo pack");
      expect(res.repo.file_count).toBe(2);
      // Full dump: exactly one generateJson call, no map phase.
      expect(generateJson.mock.calls.length).toBe(1);
      expect(generateText.mock.calls.length).toBe(0);
    } finally {
      restore();
    }
  });

  test("a big repo map-reduces: one brief per chunk, then one merge", async () => {
    // 40 files × 25 K chars ≈ 1 MB > FULL_DUMP_MAX_CHARS → map-reduce.
    const entries: Record<string, string> = {};
    for (let i = 0; i < 40; i++) entries[`src/mod${i}.ts`] = "x".repeat(25_000);
    // The exact fan-out the map phase should produce (order-independent for
    // equal-size files, so the reconstruction's count matches extraction's).
    const expectedChunks = chunkFiles(
      Object.entries(entries).map(([path, text]) => ({ path, text, truncatedFile: false })),
    ).length;
    expect(expectedChunks).toBeGreaterThan(1);

    mockGitHub({ tarball: await tarball(entries) });
    generateText.mockImplementation(async () => "slice brief: uses Postgres.");
    generateJson.mockImplementation(async () => REDUCE_VALUE);
    try {
      const res = await extractProject("https://github.com/owner/repo");
      expect(res.digest).toContain("SUM: a collaborative drawing app.");
      expect(res.digest).not.toContain("raw repo pack");
      // Exactly one MAP call per chunk, then exactly one merge (REDUCE).
      expect(generateText.mock.calls.length).toBe(expectedChunks);
      expect(generateJson.mock.calls.length).toBe(1);
    } finally {
      restore();
    }
  });

  test("a failed full dump drops to map-reduce rather than dying", async () => {
    mockGitHub({ tarball: await tarball({ "src/a.ts": "code", "src/b.ts": "more" }) });
    // First generateJson (full dump) throws; second (merge) succeeds.
    generateJson.mockImplementationOnce(THROW_IMPL).mockImplementation(async () => REDUCE_VALUE);
    generateText.mockImplementation(async () => "slice brief");
    try {
      const res = await extractProject("https://github.com/owner/repo");
      expect(res.digest).toContain("SUM: a collaborative drawing app.");
      expect(res.digest).not.toContain("raw repo pack");
      expect(generateText.mock.calls.length).toBeGreaterThan(0); // map ran
    } finally {
      restore();
    }
  });

  test("backfills a blank summary from metadata instead of dumping raw", async () => {
    mockGitHub({ tarball: await tarball({ "src/a.ts": "code" }) });
    generateJson.mockImplementation(async () => ({
      value: { ...REDUCE_VALUE.value, summary: "", architecture: "A monorepo." },
      raw: "",
    }));
    try {
      const res = await extractProject("https://github.com/owner/repo");
      expect(res.digest).not.toContain("raw repo pack");
      expect(res.digest).toContain("A monorepo.");
      expect(res.digest).toContain("A mock repo"); // summary backfilled from description
    } finally {
      restore();
    }
  });

  test("total LLM outage falls to the deterministic digest", async () => {
    mockGitHub({ tarball: await tarball({ "src/a.ts": "code", "README.md": "# hi" }) });
    // Both seams stay at THROW_IMPL → digest can't be built by the model.
    try {
      const res = await extractProject("https://github.com/owner/repo");
      expect(res.digest).toContain("raw repo pack");
      expect(res.digest).toContain("A mock repo");
    } finally {
      restore();
    }
  });

  test("a 404 on the repo is repo_not_found", async () => {
    mockGitHub({ metaStatus: 404 });
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

  test("a too-large repo is refused before downloading", async () => {
    mockGitHub({ meta: { size: 300_000 } });
    try {
      await extractProject("https://github.com/owner/huge");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number; code: string }).status).toBe(400);
      expect((err as { code: string }).code).toBe("repo_too_large");
    } finally {
      restore();
    }
  });

  test("a repo whose tarball has no usable files is empty_repo", async () => {
    mockGitHub({ tarball: await tarball({ "node_modules/x.js": "junk", "logo.png": "img" }) });
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

  test("a 5xx on the tarball is github_unavailable (502), leaking nothing", async () => {
    mockGitHub({ tarballStatus: 503 });
    try {
      await extractProject("https://github.com/owner/repo");
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as { status: number; code: string; message: string };
      expect(e.status).toBe(502);
      expect(e.code).toBe("github_unavailable");
      expect(e.message.toLowerCase()).not.toContain("bearer");
    } finally {
      restore();
    }
  });

  test("a 404 on the tarball ref surfaces as repo_not_found", async () => {
    mockGitHub({ tarballStatus: 404 });
    try {
      await extractProject("https://github.com/owner/repo/tree/nope");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { code: string }).code).toBe("repo_not_found");
    } finally {
      restore();
    }
  });
});
