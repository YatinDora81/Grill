import { test, expect, mock, beforeEach, afterAll } from "bun:test";
import { AppError } from "@/lib/errors";

mock.module("server-only", () => ({}));
mock.module("@/lib/env", () => ({
  config: {
    storageConfigured: true,
    storage: {
      endpoint: "https://acct.r2.cloudflarestorage.com",
      bucket: "test-bucket",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    video: { partUrlExpirySeconds: 900 },
    presignExpirySeconds: 300,
  },
}));

const { designImageKey, designKey, designPrefix, headObject, listParts, putAudio, putObject } =
  await import("./objectStore");

const KEY = "video/sess_1/vid_1.webm";
const UPLOAD_ID = "upload_1";

function partXml(n: number, etag: string, lastModified: string | null): string {
  const lm = lastModified === null ? "" : `<LastModified>${lastModified}</LastModified>`;
  return `<Part><PartNumber>${n}</PartNumber>${lm}<ETag>${etag}</ETag><Size>5242880</Size></Part>`;
}

function pageXml(parts: string[], next?: number): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ListPartsResult>` +
    `<Bucket>test-bucket</Bucket>` +
    `<Key>${KEY}</Key>` +
    `<UploadId>${UPLOAD_ID}</UploadId>` +
    parts.join("") +
    `<IsTruncated>${next !== undefined}</IsTruncated>` +
    (next !== undefined ? `<NextPartNumberMarker>${next}</NextPartNumberMarker>` : "") +
    `</ListPartsResult>`
  );
}

const realFetch = globalThis.fetch;
let requested: string[] = [];

function serve(...pages: Array<{ status?: number; body: string }>) {
  let i = 0;
  globalThis.fetch = mock(async (req: Request) => {
    requested.push(req.url);
    const page = pages[i++];
    if (!page) throw new Error(`unexpected list-parts request #${i}: ${req.url}`);
    return new Response(page.body, { status: page.status ?? 200 });
  }) as unknown as typeof fetch;
}

const ok = (body: string) => ({ body });

beforeEach(() => {
  requested = [];
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

test("lifts partNumber, etag and lastModified out of a ListParts page", async () => {
  serve(
    ok(
      pageXml([
        partXml(1, "&quot;aaa111&quot;", "2026-07-16T10:00:00.000Z"),
        partXml(2, "&quot;bbb222&quot;", "2026-07-16T10:00:30.000Z"),
      ]),
    ),
  );

  const parts = await listParts(KEY, UPLOAD_ID);

  expect(parts).toEqual([
    { partNumber: 1, etag: "&quot;aaa111&quot;", lastModified: Date.parse("2026-07-16T10:00:00.000Z") },
    { partNumber: 2, etag: "&quot;bbb222&quot;", lastModified: Date.parse("2026-07-16T10:00:30.000Z") },
  ]);
});

test("reports a null lastModified rather than NaN when R2 omits or mangles the timestamp", async () => {
  serve(
    ok(
      pageXml([
        partXml(1, "&quot;aaa111&quot;", null),
        partXml(2, "&quot;bbb222&quot;", "not-a-date"),
      ]),
    ),
  );

  const parts = await listParts(KEY, UPLOAD_ID);

  expect(parts.map((p) => p.lastModified)).toEqual([null, null]);
  expect(parts.map((p) => p.partNumber)).toEqual([1, 2]);
});

test("follows NextPartNumberMarker until the listing is no longer truncated", async () => {
  serve(
    ok(pageXml([partXml(1, "&quot;a&quot;", "2026-07-16T10:00:00.000Z")], 1)),
    ok(pageXml([partXml(2, "&quot;b&quot;", "2026-07-16T10:00:30.000Z")])),
  );

  const parts = await listParts(KEY, UPLOAD_ID);

  expect(parts.map((p) => p.partNumber)).toEqual([1, 2]);
  expect(requested).toHaveLength(2);
  expect(requested[0]).not.toContain("part-number-marker");
  expect(requested[1]).toContain("part-number-marker=1");
});

test("stops paginating when a page carries a marker but is not truncated", async () => {
  const finalPageWithMarker = pageXml([
    partXml(1, "&quot;a&quot;", "2026-07-16T10:00:00.000Z"),
  ]).replace("</ListPartsResult>", "<NextPartNumberMarker>1</NextPartNumberMarker></ListPartsResult>");
  serve(ok(finalPageWithMarker));

  const parts = await listParts(KEY, UPLOAD_ID);

  expect(parts.map((p) => p.partNumber)).toEqual([1]);
  expect(requested).toHaveLength(1);
});

test("sorts parts by partNumber so completion never stitches them out of order", async () => {
  serve(
    ok(
      pageXml([
        partXml(3, "&quot;c&quot;", "2026-07-16T10:01:00.000Z"),
        partXml(1, "&quot;a&quot;", "2026-07-16T10:00:00.000Z"),
        partXml(10, "&quot;j&quot;", "2026-07-16T10:05:00.000Z"),
        partXml(2, "&quot;b&quot;", "2026-07-16T10:00:30.000Z"),
      ]),
    ),
  );

  const parts = await listParts(KEY, UPLOAD_ID);

  expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 10]);
});

test("throws when R2 rejects the listing instead of reporting an empty upload", async () => {
  serve({ status: 403, body: "<Error><Code>AccessDenied</Code></Error>" });

  const err = await listParts(KEY, UPLOAD_ID).catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(503);
  expect((err as AppError).code).toBe("storage_mpu_list_failed");
});

test("returns an empty list for an upload R2 genuinely holds no parts for", async () => {
  serve(ok(pageXml([])));

  await expect(listParts(KEY, UPLOAD_ID)).resolves.toEqual([]);
});

interface Seen {
  method: string;
  url: string;
  contentType: string | null;
  body: Uint8Array | null;
}

function serveStatus(status: number): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = mock(async (req: Request) => {
    const body = req.body ? new Uint8Array(await req.arrayBuffer()) : null;
    seen.push({
      method: req.method,
      url: req.url,
      contentType: req.headers.get("content-type"),
      body,
    });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return seen;
}

const CLIP_KEY = "tts/orpheus/abc123.wav";

test("headObject reports a cache hit for an object R2 answers 200 for", async () => {
  const seen = serveStatus(200);

  await expect(headObject(CLIP_KEY)).resolves.toBe(true);

  expect(seen[0]?.method).toBe("HEAD");
  expect(seen[0]?.url).toContain(CLIP_KEY);
});

test("headObject reports a miss rather than throwing when the object is absent", async () => {
  serveStatus(404);

  await expect(headObject(CLIP_KEY)).resolves.toBe(false);
});

test("headObject throws on any other status so a broken bucket is not read as a miss", async () => {
  serveStatus(403);

  const err = await headObject(CLIP_KEY).catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(503);
  expect((err as AppError).code).toBe("storage_head_failed");
});

test("putObject PUTs the exact bytes it was handed under the given content type", async () => {
  const seen = serveStatus(200);
  const bytes = new Uint8Array([82, 73, 70, 70, 0, 1, 2, 3]);

  await putObject(CLIP_KEY, bytes, "audio/wav");

  expect(seen[0]?.method).toBe("PUT");
  expect(seen[0]?.url).toContain(CLIP_KEY);
  expect(seen[0]?.contentType).toBe("audio/wav");
  expect(Array.from(seen[0]?.body ?? [])).toEqual(Array.from(bytes));
});

test("putObject surfaces a refused upload instead of reporting success", async () => {
  serveStatus(403);

  const err = await putObject(CLIP_KEY, new Uint8Array([1]), "audio/wav").catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe("storage_put_failed");
});

test("putAudio still uploads exactly as it did before it was generalised", async () => {
  const seen = serveStatus(200);
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);

  await putAudio("audio/sess_1/turn_0.webm", bytes, "audio/webm");

  expect(seen[0]?.method).toBe("PUT");
  expect(seen[0]?.url).toContain("audio/sess_1/turn_0.webm");
  expect(seen[0]?.contentType).toBe("audio/webm");
  expect(Array.from(seen[0]?.body ?? [])).toEqual(Array.from(bytes));
});

test("a session's boards live under one prefix, so retention can sweep them in one listing", () => {
  expect(designKey("sess_1", 2)).toBe("design/sess_1/turn_2.excalidraw");
  expect(designImageKey("sess_1", 2)).toBe("design/sess_1/turn_2.png");
  expect(designKey("sess_1", 2).startsWith(designPrefix("sess_1"))).toBe(true);
  expect(designImageKey("sess_1", 2).startsWith(designPrefix("sess_1"))).toBe(true);
});
