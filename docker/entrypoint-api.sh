#!/bin/sh
set -e

PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-sintesa}"
PGDATABASE="${PGDATABASE:-sintesa}"

echo "[sintesa-api] Waiting for database at ${PGHOST}:${PGPORT}..."
until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do
  sleep 2
done

echo "[sintesa-api] Running migrations..."
node dist/db/migrate.js

if [ "${RUN_DB_SEED}" = "true" ]; then
  echo "[sintesa-api] Seeding database..."
  node dist/db/seed.js
fi

echo "[sintesa-api] Starting server on port ${PORT:-3001}..."
exec node dist/index.js