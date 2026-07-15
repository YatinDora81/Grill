#!/bin/sh
set -eu

echo "[web] applying prisma migrations…"
cd /app/packages/db
bunx prisma migrate deploy

echo "[web] starting Next.js on :${PORT:-4000}"
cd /app
exec bun run --filter web start
