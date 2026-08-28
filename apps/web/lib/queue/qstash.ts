import "server-only";
import { Client, Receiver } from "@upstash/qstash";
import { config } from "@/lib/env";
import { AppError } from "@/lib/errors";

const REPORT_WORKER_PATH = "/api/queue/report";

const PUBLISH_RETRIES = 3;

export function qstashConfigured(): boolean {
  return config.qstashConfigured;
}

export function reportWorkerUrl(): string {
  return `${config.site.url}${REPORT_WORKER_PATH}`;
}

function isReachable(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return false;
    return !(
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

let client: Client | null = null;
let clientToken = "";

function getClient(): Client {
  const token = config.qstash.token;
  if (!client || clientToken !== token) {
    client = new Client({ token });
    clientToken = token;
  }
  return client;
}

let receiver: Receiver | null = null;
let receiverKeys = "";

function getReceiver(): Receiver {
  const { currentSigningKey, nextSigningKey } = config.qstash;
  const keys = `${currentSigningKey}:${nextSigningKey}`;
  if (!receiver || receiverKeys !== keys) {
    receiver = new Receiver({ currentSigningKey, nextSigningKey });
    receiverKeys = keys;
  }
  return receiver;
}

export async function publishReportBuild(sessionId: string): Promise<void> {
  if (!qstashConfigured()) {
    throw new Error("QStash is not configured; nothing was published.");
  }
  const url = reportWorkerUrl();
  if (!isReachable(url)) {
    throw new Error(`QStash cannot deliver to ${url}; set NEXT_PUBLIC_SITE_URL to a public origin.`);
  }

  await getClient().publishJSON({
    url,
    body: { session_id: sessionId },
    retries: PUBLISH_RETRIES,
    deduplicationId: `report:${sessionId}`,
  });
}

function badSignature(): AppError {
  return new AppError(401, "bad_signature", "Invalid QStash signature.");
}

export async function verifyQstash(req: Request, rawBody: string): Promise<void> {
  if (!qstashConfigured()) {
    console.error("[qstash] worker called while QStash is unconfigured; refusing to build");
    throw badSignature();
  }

  const signature = req.headers.get("upstash-signature") ?? "";
  if (!signature) throw badSignature();

  const ok = await getReceiver()
    .verify({ signature, body: rawBody, url: reportWorkerUrl() })
    .catch(() => false);

  if (!ok) throw badSignature();
}
