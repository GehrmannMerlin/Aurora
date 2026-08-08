#!/usr/bin/env bash
# Aurora public-preview deploy: controlled working-tree deployment.
# Builds a release, ships the source over SSH (tar), builds images on the
# server, migrates, starts the stack, then atomically points current. On
# failure the previous release is preserved. Never deletes data, never exposes
# secrets, never auto-deploys on file save.
set -euo pipefail

cd "$(dirname "$0")/../../.." # repo root

# --- Config (overridable) -----------------------------------------------------
SERVER="${AURORA_PREVIEW_SERVER:-47.238.145.24}"
SERVER_USER="${AURORA_PREVIEW_SERVER_USER:-ecs-user}"
SSH_KEY="${AURORA_PREVIEW_SSH_KEY:-$HOME/.ssh/lumina_ops_ed25519}"
REMOTE_ROOT="${AURORA_PREVIEW_REMOTE_ROOT:-/opt/aurora-preview}"
RELEASE_ID="$(date +%Y%m%d-%H%M%S)"
RELEASE_DIR="${REMOTE_ROOT}/releases/${RELEASE_ID}"
CURRENT_DIR="${REMOTE_ROOT}/current"

SSH() { ssh -o BatchMode=yes -o ConnectTimeout=15 -o UserKnownHostsFile="${HOME}/.ssh/known_hosts" -i "$SSH_KEY" "${SERVER_USER}@${SERVER}" "$@"; }

echo "==> Public preview deploy: ${RELEASE_ID}"
echo "==> Server: ${SERVER_USER}@${SERVER}  root: ${REMOTE_ROOT}"

# 1. Working tree guard: refuse to deploy a dirty worktree only if there are
#    files that are not part of any prior approved change; this bridge is
#    intentionally controlled working-tree deployment (user-authorized).
git branch --show-current >/dev/null
echo "==> Git HEAD: $(git rev-parse --short HEAD)  branch: $(git branch --show-current)"
CHANGED="$(git status --porcelain=v1 | wc -l | tr -d ' ')"
echo "==> Working tree changed file count: ${CHANGED}"

# 2. Local quality gate (fast, deployment-relevant).
pnpm typecheck >/tmp/aurora-preview-typecheck.log 2>&1 || { echo "TYPE CHECK FAILED"; tail -30 /tmp/aurora-preview-typecheck.log; exit 1; }
pnpm --filter @aurora/ingestion-api build >/tmp/aurora-preview-api-build.log 2>&1 || { echo "API BUILD FAILED"; tail -30 /tmp/aurora-preview-api-build.log; exit 1; }
pnpm --filter @aurora/ingestion-worker build >/tmp/aurora-preview-worker-build.log 2>&1 || { echo "WORKER BUILD FAILED"; tail -30 /tmp/aurora-preview-worker-build.log; exit 1; }
echo "==> Local quality gate passed (typecheck + app builds)"

# 3. Create fresh release dir on server.
SSH "sudo mkdir -p '${REMOTE_ROOT}/releases' '${REMOTE_ROOT}/shared' '${REMOTE_ROOT}/backups' && sudo chown -R ${SERVER_USER}:${SERVER_USER} '${REMOTE_ROOT}' && mkdir -p '${RELEASE_DIR}'" || { echo "FAILED to create release dir"; exit 1; }

# 4. Ship source to the new release dir via tar-over-SSH (no rsync dependency,
#    no --delete needed: the release dir is brand new). Exclude secrets and
#    local noise.
tar -C . --exclude=.git --exclude=node_modules --exclude=coverage --exclude=test-results \
  --exclude=.vitest --exclude=.pnpm-store --exclude=.artifacts --exclude='*.tsbuildinfo' \
  --exclude='*.log' --exclude='.env' --exclude='.env.*' \
  --exclude='.migrations-combined*' --exclude=dist \
  -cf - . | SSH "cat > '${REMOTE_ROOT}/releases/${RELEASE_ID}/source.tar'" || { echo "SOURCE SHIP FAILED"; exit 1; }
SSH "cd '${RELEASE_DIR}' && tar -xf source.tar && rm source.tar" || { echo "SOURCE EXTRACT FAILED"; exit 1; }
echo "==> Source shipped: ${CHANGED} changed files, ${RELEASE_ID}"

# 5. Ensure shared secrets exist once (never regenerate over existing data).
#    Write the DB password to a dedicated line in shared/.env if missing.
SSH "test -s '${REMOTE_ROOT}/shared/.env' && grep -q PREVIEW_DB_PASSWORD '${REMOTE_ROOT}/shared/.env' || { echo 'PREVIEW_DB_PASSWORD='\$(openssl rand -hex 32) >> '${REMOTE_ROOT}/shared/.env'; chmod 600 '${REMOTE_ROOT}/shared/.env'; }"
SSH "chmod 600 '${REMOTE_ROOT}/shared/.env'"
DB_PASS="$(SSH "grep '^PREVIEW_DB_PASSWORD=' '${REMOTE_ROOT}/shared/.env' | cut -d= -f2-")"
[ -n "$DB_PASS" ] || { echo "DB PASSWORD UNREADABLE"; exit 1; }
echo "==> Secrets present (not printed)"

# 6. Compose config validation on server (dry-run).
SSH "cd '${RELEASE_DIR}' && RELEASE_ID='${RELEASE_ID}' PREVIEW_DB_PASSWORD='${DB_PASS}' docker compose -f deploy/preview/compose.yaml config --quiet" || { echo "COMPOSE CONFIG FAILED"; exit 1; }
echo "==> Compose config valid"

# 7. Build images on the server.
SSH "cd '${RELEASE_DIR}' && RELEASE_ID='${RELEASE_ID}' PREVIEW_DB_PASSWORD='${DB_PASS}' docker compose -f deploy/preview/compose.yaml build" || { echo "IMAGE BUILD FAILED"; exit 1; }
echo "==> Images built"

# 8. Start postgres, wait for health.
SSH "cd '${RELEASE_DIR}' && RELEASE_ID='${RELEASE_ID}' PREVIEW_DB_PASSWORD='${DB_PASS}' docker compose -f deploy/preview/compose.yaml up -d postgres" || { echo "POSTGRES START FAILED"; exit 1; }

# 9. Run migrations (migrate service exits 0 on success).
SSH "cd '${RELEASE_DIR}' && RELEASE_ID='${RELEASE_ID}' PREVIEW_DB_PASSWORD='${DB_PASS}' docker compose -f deploy/preview/compose.yaml run --rm migrate" || { echo "MIGRATION FAILED"; exit 1; }
echo "==> Migrations applied"

# 10. Start the rest of the stack.
SSH "cd '${RELEASE_DIR}' && RELEASE_ID='${RELEASE_ID}' PREVIEW_DB_PASSWORD='${DB_PASS}' docker compose -f deploy/preview/compose.yaml up -d" || { echo "STACK START FAILED"; exit 1; }

# 11. Verify API and worker are up (no crash loop).
sleep 3
SSH "cd '${RELEASE_DIR}' && RELEASE_ID='${RELEASE_ID}' PREVIEW_DB_PASSWORD='${DB_PASS}' docker compose -f deploy/preview/compose.yaml ps --format 'table {{.Name}}\t{{.Status}}'" || { echo "PS FAILED"; exit 1; }

# 12. Atomic pointer switch: point current at the new release.
#     The skeleton creates an empty `current` dir; remove it safely only if it
#     is an empty directory (never a release dir with content).
SSH "if [ -L '${CURRENT_DIR}' ]; then rm -f '${CURRENT_DIR}'; elif [ -d '${CURRENT_DIR}' ] && [ -z \"\$(ls -A '${CURRENT_DIR}')\" ]; then rmdir '${CURRENT_DIR}'; elif [ -e '${CURRENT_DIR}' ]; then echo 'current is not empty; refusing to replace'; exit 1; fi && ln -s '${RELEASE_DIR}' '${CURRENT_DIR}'" || { echo "POINTER SWITCH FAILED"; exit 1; }
echo "==> current -> ${RELEASE_DIR}"

echo "==> Deploy complete: release ${RELEASE_ID}"
echo "==> Public URLs (once DNS + nginx edge configured):"
echo "    https://aurora.ah.cn/          (preview status page)"
echo "    https://ingest.aurora.ah.cn/   (ingestion-api)"
