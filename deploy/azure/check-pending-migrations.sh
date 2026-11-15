#!/usr/bin/env bash
set -euo pipefail

error_file=$(mktemp)
trap 'rm -f "$error_file"' EXIT
set +e
server_id=$(az postgres flexible-server show \
  --resource-group tomoribot-rg \
  --name tomoribot-postgres \
  --query id \
  --output tsv \
  --only-show-errors 2>"$error_file")
status=$?
set -e

if [ "$status" -eq 0 ]; then
  echo "is_initial_bootstrap=false" >> "$GITHUB_OUTPUT"
  echo "Azure PostgreSQL server already exists: $server_id"
elif grep -Eq "ResourceNotFound|ResourceGroupNotFound|could not be found" "$error_file"; then
  echo "is_initial_bootstrap=true" >> "$GITHUB_OUTPUT"
  echo "Azure PostgreSQL server does not exist; treating this as initial bootstrap."
  exit 0
else
  cat "$error_file" >&2
  exit "$status"
fi

LAST_GREEN=$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/deploy-azure.yml/runs?branch=${GITHUB_REF_NAME}&status=success&per_page=1" --jq '.workflow_runs[0].head_sha' 2>/dev/null || true)
if [ -z "$LAST_GREEN" ] || [ "$LAST_GREEN" = "null" ]; then
  LAST_GREEN=$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/deploy-tomoribot-azure.yml/runs?branch=${GITHUB_REF_NAME}&status=success&per_page=1" --jq '.workflow_runs[0].head_sha' 2>/dev/null || true)
fi
PREV_REF=""
if [ -n "$LAST_GREEN" ] && [ "$LAST_GREEN" != "null" ] && git cat-file -e "${LAST_GREEN}^{commit}" 2>/dev/null && git merge-base --is-ancestor "$LAST_GREEN" HEAD; then
  PREV_REF="$LAST_GREEN"
  echo "Diffing migrations against the last successful deploy: $PREV_REF"
fi

if [ -z "$PREV_REF" ]; then
  echo "::warning::No reachable successful deploy. Scanning all migrations; destructive SQL requires downtime."
  scan_args=(--all)
else
  scan_args=(--changed-since "$PREV_REF" --deployed-ref "$PREV_REF")
fi
scan_args+=(--allow-downtime)

if [ "$RECOVERY_POINT_OPT_IN" = "true" ]; then scan_args+=(--recovery-point-opt-in); fi
bun run scripts/checks/checkPendingMigrations.ts "${scan_args[@]}"
