import "server-only";
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

export function audioPrefix(sessionId: string): string {
  return `audio/${sessionId}/`;
}

export function audioKey(sessionId: string, turnIndex: number, ext = "webm"): string {
  return `${audioPrefix(sessionId)}turn_${turnIndex}.${ext}`;
}

export async function putObject(key: string, data: Uint8Array, contentType: string): Promise<void> {
  const res = await client().fetch(objectUrl(key), {
    method: "PUT",
    body: data as unknown as BodyInit,
    headers: {
      "content-type": contentType,
      "content-length": String(data.byteLength),
    },
  });
  if (!res.ok) {
    throw serviceUnavailable(`Storage PUT failed (${res.status}).`, "storage_put_failed");
  }
}

export function putAudio(key: string, data: Uint8Array, contentType: string): Promise<void> {
  return putObject(key, data, contentType);
}

export async function headObject(key: string): Promise<boolean> {
  const res = await client().fetch(objectUrl(key), { method: "HEAD" });
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw serviceUnavailable(`Storage HEAD failed (${res.status}).`, "storage_head_failed");
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

export function videoKey(sessionId: string, videoId: string, ext = "webm"): string {
  return `video/${sessionId}/${videoId}.${ext}`;
}

export const PART_BYTES = 5 * 1024 * 1024;

function xmlTag(xml: string, tag: string): string | null {
  return new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml)?.[1] ?? null;
}

function subresourceUrl(key: string, params: Record<string, string>): URL {
  const url = new URL(objectUrl(key));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

export async function createMultipart(key: string, contentType: string): Promise<string> {
  const res = await client().fetch(subresourceUrl(key, { uploads: "" }).toString(), {
    method: "POST",
    headers: { "content-type": contentType, "content-length": "0" },
  });
  const body = await res.text();
  const uploadId = res.ok ? xmlTag(body, "UploadId") : null;
  if (!uploadId) {
    throw serviceUnavailable(`Storage multipart create failed (${res.status}).`, "storage_mpu_create_failed");
  }
  return uploadId;
}

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
  lastModified: number | null;
}

export async function listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
  const parts: UploadedPart[] = [];
  let marker: string | undefined;

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
  if (!res.ok || !text.includes("<CompleteMultipartUploadResult")) {
    throw serviceUnavailable(`Storage multipart complete failed (${res.status}).`, "storage_mpu_complete_failed");
  }
}

export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  const res = await client().fetch(subresourceUrl(key, { uploadId }).toString(), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw serviceUnavailable(`Storage multipart abort failed (${res.status}).`, "storage_mpu_abort_failed");
  }
}

export async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

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

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function deleteObject(key: string): Promise<void> {
  const res = await client().fetch(objectUrl(key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw serviceUnavailable(`Storage DELETE failed (${res.status}).`, "storage_delete_failed");
  }
}
