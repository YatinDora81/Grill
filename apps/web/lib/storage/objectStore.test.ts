import { test, expect, mock, beforeEach, afterAll } from "bun:test";
import { AppError } from "@/lib/errors";

/**
 * listParts is the only witness to what R2 actually holds, and settling reads it
 * to decide between completing an upload and deleting it. Both outcomes are
 * irreversible, and both are driven by fields this regex parser lifts out of
 * XML: `lastModified` decides whether a browser is still writing, `partNumber`
 * decides the stitching order, and an empty result means "there is no recording
 * here". So a misparse does not throw — it quietly destroys a recording, which
 * is why the parser is pinned against R2's real wire format rather than through
 * its callers.
 */

// `server-only` is a build-time marker that throws when imported outside an RSC,
// and env refuses to load without real secrets. aws4fetch signs for real against
// these — only the network below it is stubbed.
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

const { listParts } = await import("./objectStore");

const KEY = "video/sess_1/vid_1.webm";
const UPLOAD_ID = "upload_1";

/**
 * One <Part> as R2 writes it. `lastModified: null` omits the tag altogether,
 * which is how R2 behaves for a part it has not finished accounting for.
 */
function partXml(n: number, etag: string, lastModified: string | null): string {
  const lm = lastModified === null ? "" : `<LastModified>${lastModified}</LastModified>`;
  return `<Part><PartNumber>${n}</PartNumber>${lm}<ETag>${etag}</ETag><Size>5242880</Size></Part>`;
}

/** A ListPartsResult page. Passing `next` marks it truncated at that marker. */
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

/**
 * Serve `pages` in order, one per request. Running past the end throws rather
 * than repeating the last page: a pagination bug that re-requests forever must
 * surface as a failure, not hang the suite.
 */
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

  // The ETag stays XML-escaped exactly as R2 sent it, which is correct rather
  // than sloppy: completeMultipart re-embeds this string in XML, so `&quot;`
  // round-trips back to `"` at R2. Decoding it here would send raw quotes.
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

  // NaN is the dangerous value here, not null. Settling compares
  // `Date.now() - lastModified < graceMs`, and every comparison against NaN is
  // false — so a NaN timestamp reads as "nobody has written for ages" and the
  // upload gets stitched shut under a browser that is still pushing parts.
  // null is a value the caller checks for explicitly.
  expect(parts.map((p) => p.lastModified)).toEqual([null, null]);
  expect(parts.map((p) => p.partNumber)).toEqual([1, 2]);
});

test("follows NextPartNumberMarker until the listing is no longer truncated", async () => {
  serve(
    ok(pageXml([partXml(1, "&quot;a&quot;", "2026-07-16T10:00:00.000Z")], 1)),
    ok(pageXml([partXml(2, "&quot;b&quot;", "2026-07-16T10:00:30.000Z")])),
  );

  const parts = await listParts(KEY, UPLOAD_ID);

  // A page holds 1000 parts and an hour of video exceeds that. Dropping the
  // marker truncates the recording at the page boundary — and because the
  // stitched file still "completes", the loss is silent.
  expect(parts.map((p) => p.partNumber)).toEqual([1, 2]);
  expect(requested).toHaveLength(2);
  expect(requested[0]).not.toContain("part-number-marker");
  expect(requested[1]).toContain("part-number-marker=1");
});

test("stops paginating when a page carries a marker but is not truncated", async () => {
  // R2 sends NextPartNumberMarker on the final page too. Looping on the marker's
  // presence instead of IsTruncated would re-request the same page forever.
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

  // Order is the whole file. completeMultipart emits parts in the order it is
  // handed them, so an unsorted list produces an object whose bytes are
  // shuffled — it completes cleanly and plays back as garbage. The 10-vs-2 pair
  // also pins numeric sorting: lexicographic order would put 10 before 2, and
  // the contiguous-prefix check in settling would then stop at part 1.
  expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 10]);
});

test("throws when R2 rejects the listing instead of reporting an empty upload", async () => {
  // 403, not 500: aws4fetch retries 5xx/429 ten times with backoff, so a 5xx
  // here would spend ~25s in the client before ever reaching this code.
  serve({ status: 403, body: "<Error><Code>AccessDenied</Code></Error>" });

  // The distinction is load-bearing: settling reads an empty part list as "the
  // camera never recorded anything" and aborts the upload plus deletes the row.
  // Swallowing this error into [] would turn a transient auth blip into a
  // deleted interview recording.
  const err = await listParts(KEY, UPLOAD_ID).catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(503);
  expect((err as AppError).code).toBe("storage_mpu_list_failed");
});

test("returns an empty list for an upload R2 genuinely holds no parts for", async () => {
  serve(ok(pageXml([])));

  // The counterpart to the test above: empty must stay reachable, or a camera
  // that was never granted permission leaves an orphan upload nothing reaps.
  await expect(listParts(KEY, UPLOAD_ID)).resolves.toEqual([]);
});
