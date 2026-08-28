import "server-only";
import { Redis } from "@upstash/redis";
import { config } from "@/lib/env";

const RETRY_ATTEMPTS = 1;
const RETRY_BACKOFF_MS = 50;

let client: Redis | null = null;
let clientUrl = "";

export function getRedis(): Redis | null {
  const { redisUrl, redisToken } = config.upstash;
  if (!redisUrl || !redisToken) return null;
  if (!client || clientUrl !== redisUrl) {
    client = new Redis({
      url: redisUrl,
      token: redisToken,
      retry: { retries: RETRY_ATTEMPTS, backoff: () => RETRY_BACKOFF_MS },
    });
    clientUrl = redisUrl;
  }
  return client;
}

export type { Redis };

export function redisConfigured(): boolean {
  return config.redisConfigured;
}
