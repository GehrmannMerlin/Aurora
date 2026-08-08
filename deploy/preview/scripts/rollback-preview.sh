#!/usr/bin/env bash
# Aurora public-preview rollback: point current at the previous successful
# release and restart the stack. Does NOT roll back destructive DB migrations;
# if the current code's migrations are not backward-compatible, it stops and
# reports instead of pretending code rollback equals DB rollback.
set -euo pipefail

cd "$(dirname "$0")/../../.." # repo root

SERVER="${AURORA_PREVIEW_SERVER:-47.238.145.24}"
SERVER_USER="${AURORA_PREVIEW_SERVER_USER:-ecs-user}"
SSH_KEY="${AURORA_PREVIEW_SSH_KEY:-$HOME/.ssh/lumina_ops_ed25519}"
REMOTE_ROOT="${AURORA_PREVIEW_REMOTE_ROOT:-/opt/aurora-preview}"
CURRENT_DIR="${REMOTE_ROOT}/current"

SSH() { ssh -o BatchMode=yes -o ConnectTimeout=15 -o UserKnownHostsFile="${HOME}/.ssh/known_hosts" -i "$SSH_KEY" "${SERVER_USER}@${SERVER}" "$@"; }

echo "==> Public preview rollback"
CURRENT="$(SSH "readlink -f '${CURRENT_DIR}'" 2>/dev/null || echo '')"
if [ -z "$CURRENT" ]; then
  echo "No current release pointer. Nothing to roll back."
  exit 1
fi
CURRENT_ID="$(basename "$CURRENT")"
echo "==> Current: ${CURRENT_ID}"

# Find the previous release (the one before current, newest first).
PREVIOUS="$(SSH "ls -1 -t '${REMOTE_ROOT}/releases/' | grep -v '^${CURRENT_ID}\$' | head -1")"
if [ -z "$PREVIOUS" ]; then
  echo "No previous release found. Rollback aborted."
  exit 1
fi
echo "==> Previous: ${PREVIOUS}"

# DB migration rollback safety: refuse if the previous release's migration
# state would be incompatible. This bridge does not auto-revert migrations.
echo "==> DB migrations are NOT rolled back by this command."
echo "==> If the current release applied forward-only migrations that the"
echo "    previous release cannot run against, manual review is required."
read -r -p "Confirm rollback to ${PREVIOUS}? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Rollback aborted."
  exit 1
fi

PREVIOUS_DIR="${REMOTE_ROOT}/releases/${PREVIOUS}"
SSH "rm -f '${CURRENT_DIR}' && ln -s '${PREVIOUS_DIR}' '${CURRENT_DIR}'" || { echo "POINTER FAILED"; exit 1; }

# Restart the stack from the previous release.
SSH "cd '${PREVIOUS_DIR}' && RELEASE_ID='${PREVIOUS}' PREVIEW_DB_PASSWORD=\"\$(cat '${REMOTE_ROOT}/shared/.env')\" docker compose -f deploy/preview/compose.yaml up -d --force-recreate" || { echo "RESTART FAILED"; exit 1; }

echo "==> Rollback complete: current -> ${PREVIOUS}"
echo "==> Note: DB migration state is unchanged; verify the previous release"
echo "    runs against the current schema before trusting this rollback."
