#!/usr/bin/env bash
# Aurora OPS-07 focused local restore smoke (evidence-only, NOT the production
# RPO/RTO drill). Uses the disposable local PostgreSQL container
# (aurora-test-pg on 15432). Creates a small dataset, pg_dump backup, restores
# into a scratch DB, verifies critical rows, then drops the scratch DBs.
#
#   bash deploy/aws/restore-smoke.sh
#   AURORA_RESTORE_CONTAINER=<name> bash deploy/aws/restore-smoke.sh
#
# Output: machine-readable evidence line. Success exit 0; failure exit 1.
set -euo pipefail

# Disable Git Bash (MSYS) path conversion so in-container paths like /tmp/...
# are passed to docker unchanged on Windows hosts.
export MSYS_NO_PATHCONV=1

CONTAINER="${AURORA_RESTORE_CONTAINER:-aurora-test-pg}"
PG_USER="${AURORA_RESTORE_PGUSER:-aurora}"
SRC="aurora_restore_smoke_src"
DST="aurora_restore_smoke_restored"

docker start "$CONTAINER" >/dev/null 2>&1 || true

# Wait for PostgreSQL to finish starting (the container may be doing crash
# recovery after being stopped).
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U "$PG_USER" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U "$PG_USER" >/dev/null 2>&1 \
  || { echo "restore-smoke FAIL: postgres not ready in ${CONTAINER}"; exit 1; }

docker exec "$CONTAINER" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${SRC}" \
  -c "DROP DATABASE IF EXISTS ${DST}" >/dev/null

docker exec "$CONTAINER" createdb -U "$PG_USER" "$SRC"
docker exec "$CONTAINER" psql -U "$PG_USER" -d "$SRC" -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE evt(id bigint primary key, payload jsonb NOT NULL)" \
  -c "INSERT INTO evt VALUES (1,'{\"a\":1}'),(2,'{\"b\":2}'),(3,'{\"c\":3}')" >/dev/null

docker exec "$CONTAINER" pg_dump -U "$PG_USER" -d "$SRC" --no-owner --no-privileges \
  -f /tmp/aurora_restore_dump.sql

docker exec "$CONTAINER" createdb -U "$PG_USER" "$DST"
docker exec "$CONTAINER" sh -c \
  "psql -U ${PG_USER} -d ${DST} -v ON_ERROR_STOP=1 -f /tmp/aurora_restore_dump.sql" >/dev/null

COUNT=$(docker exec "$CONTAINER" psql -U "$PG_USER" -d "$DST" -tAc "SELECT count(*) FROM evt")

docker exec "$CONTAINER" psql -U "$PG_USER" -d postgres -c "DROP DATABASE ${DST}" >/dev/null
docker exec "$CONTAINER" psql -U "$PG_USER" -d postgres -c "DROP DATABASE ${SRC}" >/dev/null

if [ "$COUNT" != "3" ]; then
  echo "restore-smoke FAIL: expected 3 rows after restore, got ${COUNT}"
  exit 1
fi

echo "restore-smoke PASS: dataset of 3 rows backed up (pg_dump) and restored with row count verified"
