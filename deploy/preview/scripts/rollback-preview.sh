#!/usr/bin/env bash
# Aurora public-preview rollback: point current at the previous successful
# release and restart the stack. Does NOT roll back destructive DB migrations;
# if the current code's migrations are not backward-compatible, it stops and
# reports instead of pretending code rollback equals DB rollback.
#
# CI mode (CI=1): non-interactive (auto-confirms rollback, which the workflow
# explicitly authorized), uses env-provided SSH key + known_hosts pinning.
set -euo pipefail

cd "$(dirname "$0")/../../.." # repo root

SERVER="${AURORA_PREVIEW_SERVER:-47.238.145.24}"
SERVER_USER="${AURORA_PREVIEW_SERVER_USER:-ecs-user}"
SSH_KEY="${AURORA_PREVIEW_SSH_KEY:-$HOME/.ssh/lumina_ops_ed25519}"
KNOWN_HOSTS="${AURORA_PREVIEW_KNOWN_HOSTS:-${HOME}/.ssh/known_hosts}"
REMOTE_ROOT="${AURORA_PREVIEW_REMOTE_ROOT:-/opt/aurora-preview}"
CURRENT_DIR="${REMOTE_ROOT}/current"
COMPATIBILITY_MARKER="deploy/preview/email-outbox-schema-compatibility"

SSH() { ssh -o BatchMode=yes -o ConnectTimeout=15 -o UserKnownHostsFile="$KNOWN_HOSTS" -i "$SSH_KEY" "${SERVER_USER}@${SERVER}" "$@"; }

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
PREVIOUS_DIR="${REMOTE_ROOT}/releases/${PREVIOUS}"

# Compare the release-owned email Outbox schema contract before stopping or
# switching anything. A missing marker means the release predates this safety
# contract and is incompatible by default; CI never bypasses this check.
CURRENT_COMPAT="$(SSH "cat '${CURRENT}/${COMPATIBILITY_MARKER}'" 2>/dev/null || echo '')"
PREVIOUS_COMPAT="$(SSH "cat '${PREVIOUS_DIR}/${COMPATIBILITY_MARKER}'" 2>/dev/null || echo '')"
if [ -z "$CURRENT_COMPAT" ] || [ -z "$PREVIOUS_COMPAT" ] || [ "$CURRENT_COMPAT" != "$PREVIOUS_COMPAT" ]; then
  echo "ROLLBACK INCOMPATIBLE: email Outbox schema compatibility markers are missing or differ."
  echo "Keep platform-worker stopped and perform the documented manual compatibility review."
  exit 1
fi

# DB migration rollback safety: refuse if the previous release's migration
# state would be incompatible. This bridge does not auto-revert migrations.
echo "==> DB migrations are NOT rolled back by this command."
echo "==> If the current release applied forward-only migrations that the"
echo "    previous release cannot run against, manual review is required."
if [ "${CI:-0}" = "1" ]; then
  CONFIRM="y" # CI rollback is explicitly authorized by the workflow.
else
  read -r -p "Confirm rollback to ${PREVIOUS}? [y/N] " CONFIRM
fi
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Rollback aborted."
  exit 1
fi

# Stop the current email consumer before changing the release pointer. If any
# later step fails, delivery remains safely paused rather than running old code
# against the migrated Outbox schema.
SSH "cd '${CURRENT}' && RELEASE_ID='${CURRENT_ID}' docker compose --env-file '${REMOTE_ROOT}/shared/.env' -f deploy/preview/compose.yaml stop platform-worker" || { echo "WORKER STOP FAILED"; exit 1; }

SSH "rm -f '${CURRENT_DIR}' && ln -s '${PREVIOUS_DIR}' '${CURRENT_DIR}'" || { echo "POINTER FAILED"; exit 1; }

# Restart the stack from the previous release.
SSH "cd '${PREVIOUS_DIR}' && RELEASE_ID='${PREVIOUS}' docker compose --env-file '${REMOTE_ROOT}/shared/.env' -f deploy/preview/compose.yaml up -d --force-recreate" || { echo "RESTART FAILED"; exit 1; }

echo "==> Rollback complete: current -> ${PREVIOUS}"
echo "==> Note: DB migration state is unchanged; verify the previous release"
echo "    runs against the current schema before trusting this rollback."
