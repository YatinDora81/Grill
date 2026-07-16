import "server-only";
/**
 * Object storage (Grill §Audio & upload). Private bucket (Cloudflare R2).
 * Store object KEYS, never public URLs; mint short-lived presigned URLs on
 * demand. Uses aws4fetch — portable across Node/Edge/Bun runtimes.
 */
import { AwsClient } from "aws4fetch";
import { config } from "@/lib/env";
import { serviceUnavailable } from "@/lib/errors";

let aws: AwsClient | null = null;

function client(): AwsClient {
  if (!config.storageConfigured) {
    throw serviceUnavailable("Object storage is not configured.", "storage_unconfigured");
  }
  if (!aws) {
    aws = new AwsClient({
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
      region: "auto",
      service: "s3",
    });
  }
  return aws;
}

function objectUrl(key: string): string {
  const base = config.storage.endpoint.replace(/\/$/, "");
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${config.storage.bucket}/${encoded}`;
}

/** Every audio object for a session sits under this prefix — see `audioKey`. */
export function audioPrefix(sessionId: string): string {
  return `audio/${sessionId}/`;
}

/**
 * Deterministic key for an answer's audio.
 *
 * Deterministic on purpose: a retry of the same turn overwrites its clip rather
 * than leaving a second one behind, and the retention sweep can find every clip
 * a session owns from the session id alone (`audioPrefix`) without a row per
 * object. Keep it under `audioPrefix` — the sweep deletes by that prefix.
 */
export function audioKey(sessionId: string, turnIndex: number, ext = "webm"): string {
  return `${audioPrefix(sessionId)}turn_${turnIndex}.${ext}`;
}

export async function putAudio(key: string, data: Uint8Array, contentType: string): Promise<void> {
  const res = await client().fetch(objectUrl(key), {
    method: "PUT",
    body: data as unknown as BodyInit,
    headers: {
      "content-type": contentType,
      // Next patches global fetch, and the patch re-wraps this Uint8Array as a
      // stream — which drops the implicit Content-Length and sends the PUT
      // chunked. R2 rejects chunked uploads with 411, so set the length
      // explicitly. aws4fetch treats content-length as unsignable, so this
      // stays out of the SigV4 signature.
      "content-length": String(data.byteLength),
    },
  });
  if (!res.ok) {
    throw serviceUnavailable(`Storage PUT failed (${res.status}).`, "storage_put_failed");
  }
}

export async function getAudio(key: string): Promise<Uint8Array> {
  const res = await client().fetch(objectUrl(key), { method: "GET" });
  if (!res.ok) throw serviceUnavailable(`Storage GET failed (${res.status}).`, "storage_get_failed");
  return new Uint8Array(await res.arrayBuffer());
}

async function presign(
  key: string,
  method: "GET" | "PUT",
  expiresIn = config.presignExpirySeconds,
): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  const signed = await client().sign(url.toString(), {
    method,
    aws: { signQuery: true },
  });
  return signed.url;
}

export const presignGet = (key: string, expiresIn?: number) => presign(key, "GET", expiresIn);
export const presignPut = (key: string, expiresIn?: number) => presign(key, "PUT", expiresIn);

// ── Multipart upload (session video) ──────────────────────────────
//
// Video cannot use putAudio's route. A Vercel function's request body caps at
// 4.5 MB and R2's minimum multipart part size is 5 MiB, so a part can never fit
// through our own server — the browser has to PUT each part straight to R2 with
// a presigned URL, and we only ever create, sign, list and complete.

/** Deterministic key for a session's camera recording. */
export function videoKey(sessionId: string, videoId: string, ext = "webm"): string {
  return `video/${sessionId}/${videoId}.${ext}`;
}

/**
 * R2's minimum size for every part except the last, and R2 is stricter than S3:
 * all non-final parts must be the SAME size. So the client buffers to exactly
 * this and never flushes "whatever it has".
 */
export const PART_BYTES = 5 * 1024 * 1024;

/** Pull one tag's text out of an S3 XML response. Enough for these four calls. */
function xmlTag(xml: string, tag: string): string | null {
  return new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml)?.[1] ?? null;
}

/**
 * A signed URL for a multipart sub-resource (?uploads, ?uploadId=, ?partNumber=).
 *
 * `presign` above cannot do this: it builds the URL through `objectUrl`, which
 * percent-encodes every path segment — a `?` would arrive as `%3F` and address
 * an object with a literal question mark in its name. Query params have to be
 * attached before signing so aws4fetch folds them into the canonical query
 * string, which is why this exists separately rather than as a flag.
 */
function subresourceUrl(key: string, params: Record<string, string>): URL {
  const url = new URL(objectUrl(key));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

export async function createMultipart(key: string, contentType: string): Promise<string> {
  const res = await client().fetch(subresourceUrl(key, { uploads: "" }).toString(), {
    method: "POST",
    // Explicit zero length for the same reason putAudio sets one: Next's patched
    // fetch otherwise sends this chunked and R2 answers 411.
    headers: { "content-type": contentType, "content-length": "0" },
  });
  const body = await res.text();
  const uploadId = res.ok ? xmlTag(body, "UploadId") : null;
  if (!uploadId) {
    throw serviceUnavailable(`Storage multipart create failed (${res.status}).`, "storage_mpu_create_failed");
  }
  return uploadId;
}

/** A URL the BROWSER uses to PUT one part directly to R2. */
export function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn = config.video.partUrlExpirySeconds,
): Promise<string> {
  const url = subresourceUrl(key, { uploadId, partNumber: String(partNumber) });
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  return client()
    .sign(url.toString(), { method: "PUT", aws: { signQuery: true } })
    .then((s) => s.url);
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
  /** When R2 received this part. The only evidence of whether anyone is still writing. */
  lastModified: number | null;
}

/**
 * The parts R2 actually received.
 *
 * Asking R2 rather than trusting the client is what keeps ETags out of the
 * browser entirely — which also means R2's CORS config never needs to expose the
 * ETag header, and a client that dies mid-upload still leaves a completable set.
 */
export async function listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
  const parts: UploadedPart[] = [];
  let marker: string | undefined;

  // Paginated: 1000 parts per page, and an hour of video exceeds that.
  do {
    const params: Record<string, string> = { uploadId };
    if (marker) params["part-number-marker"] = marker;
    const res = await client().fetch(subresourceUrl(key, params).toString(), { method: "GET" });
    if (!res.ok) {
      throw serviceUnavailable(`Storage list parts failed (${res.status}).`, "storage_mpu_list_failed");
    }
    const xml = await res.text();
    for (const block of xml.match(/<Part>[\s\S]*?<\/Part>/g) ?? []) {
      const n = xmlTag(block, "PartNumber");
      const etag = xmlTag(block, "ETag");
      const at = xmlTag(block, "LastModified");
      if (n && etag) {
        const t = at ? Date.parse(at) : NaN;
        parts.push({ partNumber: Number(n), etag, lastModified: Number.isNaN(t) ? null : t });
      }
    }
    marker =
      xmlTag(xml, "IsTruncated") === "true"
        ? (xmlTag(xml, "NextPartNumberMarker") ?? undefined)
        : undefined;
  } while (marker);

  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: UploadedPart[],
): Promise<void> {
  const xml =
    `<CompleteMultipartUpload>` +
    parts
      .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
      .join("") +
    `</CompleteMultipartUpload>`;
  const body = new TextEncoder().encode(xml);

  const res = await client().fetch(subresourceUrl(key, { uploadId }).toString(), {
    method: "POST",
    body: body as unknown as BodyInit,
    headers: { "content-type": "application/xml", "content-length": String(body.byteLength) },
  });
  const text = await res.text();
  // S3 semantics allow a 200 that carries an <Error> body — the connection is
  // held open while the parts are stitched, so failure arrives after the status
  // line. Trusting res.ok here would mark a broken upload complete.
  if (!res.ok || !text.includes("<CompleteMultipartUploadResult")) {
    throw serviceUnavailable(`Storage multipart complete failed (${res.status}).`, "storage_mpu_complete_failed");
  }
}

export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  const res = await client().fetch(subresourceUrl(key, { uploadId }).toString(), { method: "DELETE" });
  // 404 means it's already gone, which is the state we wanted anyway.
  if (!res.ok && res.status !== 404) {
    throw serviceUnavailable(`Storage multipart abort failed (${res.status}).`, "storage_mpu_abort_failed");
  }
}

/**
 * Every object key under a prefix.
 *
 * The audio retention sweep's eyes. Audio has no row per clip, so R2 itself is
 * the only complete record of what exists — including objects a failed answer
 * orphaned, which no `audioKey` column names and a DB-driven sweep would
 * therefore never reap.
 *
 * Note this addresses a prefix, not an object, so it deliberately does NOT go
 * through `objectUrl` — that percent-encodes each path segment, which is right
 * for a key containing `/` and wrong for a query param.
 */
export async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  // Paginated: 1000 keys per page. A session never has that many clips, but the
  // loop costs nothing and a truncated sweep would silently leave objects behind.
  do {
    const url = new URL(`${config.storage.endpoint.replace(/\/$/, "")}/${config.storage.bucket}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);

    const res = await client().fetch(url.toString(), { method: "GET" });
    if (!res.ok) {
      throw serviceUnavailable(`Storage list failed (${res.status}).`, "storage_list_failed");
    }
    const xml = await res.text();
    for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
      const key = xmlTag(block, "Key");
      if (key) keys.push(decodeXml(key));
    }
    token =
      xmlTag(xml, "IsTruncated") === "true"
        ? (xmlTag(xml, "NextContinuationToken") ?? undefined)
        : undefined;
  } while (token);

  return keys;
}

/** S3 XML-escapes key text; `&amp;` in a key we then re-sign must come back as `&`. */
function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Delete an object. Used by the retention sweep. */
export async function deleteObject(key: string): Promise<void> {
  const res = await client().fetch(objectUrl(key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw serviceUnavailable(`Storage DELETE failed (${res.status}).`, "storage_delete_failed");
  }
}
