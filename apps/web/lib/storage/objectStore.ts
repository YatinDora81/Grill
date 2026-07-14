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

/** Deterministic key for an answer's audio. */
export function audioKey(sessionId: string, turnIndex: number, ext = "webm"): string {
  return `audio/${sessionId}/turn_${turnIndex}.${ext}`;
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
