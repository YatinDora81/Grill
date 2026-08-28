/* global process */
import { Client } from "@upstash/qstash";

const DEFAULT_CRON = "*/10 * * * *";
const SWEEP_PATH = "/api/cron/reports";

const TIMEOUT_SECONDS = 300;

const RETRIES = 0;

function arg(name, fallback = null) {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
}

function fail(message) {
  console.error(`[qstash-schedule] ${message}`);
  process.exit(1);
}

const token = process.env.QSTASH_TOKEN;
if (!token) fail("QSTASH_TOKEN is not set. Copy it from https://console.upstash.com/qstash.");

const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) {
  fail("CRON_SECRET is not set. The sweep route refuses every request without it.");
}

const siteUrl = String(arg("url", process.env.NEXT_PUBLIC_SITE_URL ?? "")).replace(/\/+$/, "");
if (!siteUrl) fail("Set NEXT_PUBLIC_SITE_URL, or pass --url=https://your-deployment.example.");
if (!siteUrl.startsWith("https://")) {
  fail(`QStash calls over the public internet, so ${siteUrl} will never be reachable. Use an https origin.`);
}

const destination = `${siteUrl}${SWEEP_PATH}`;
const cron = String(arg("cron", DEFAULT_CRON));
const dryRun = arg("dry-run") === true;
const remove = arg("delete") === true;

const client = new Client({ token });

const existing = (await client.schedules.list()).filter((s) => s.destination === destination);
for (const schedule of existing) {
  console.log(`[qstash-schedule] existing schedule ${schedule.scheduleId} (${schedule.cron})`);
  if (dryRun) continue;
  await client.schedules.delete(schedule.scheduleId);
  console.log(`[qstash-schedule] deleted ${schedule.scheduleId}`);
}

if (remove) {
  console.log(
    dryRun
      ? `[qstash-schedule] dry run: would delete ${existing.length} schedule(s) for ${destination}`
      : `[qstash-schedule] done — nothing is scheduled for ${destination} any more.`,
  );
  process.exit(0);
}

if (dryRun) {
  console.log(`[qstash-schedule] dry run: would schedule "${cron}" → GET ${destination}`);
  process.exit(0);
}

const { scheduleId } = await client.schedules.create({
  destination,
  method: "GET",
  cron,
  retries: RETRIES,
  timeout: TIMEOUT_SECONDS,
  headers: { Authorization: `Bearer ${cronSecret}` },
  redact: { header: ["Authorization"] },
});

console.log(`[qstash-schedule] created ${scheduleId}: "${cron}" → GET ${destination}`);
