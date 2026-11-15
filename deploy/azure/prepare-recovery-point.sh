#!/usr/bin/env bash
set -euo pipefail
server_info=$(az postgres flexible-server show \
  --resource-group tomoribot-rg \
  --name tomoribot-postgres \
  --output json)
tier=$(jq -er '.sku.tier' <<<"$server_info")
if [ "$tier" = "Burstable" ]; then
  if ! jq -e '
    .state == "Ready" and
    (.backup.backupRetentionDays | type == "number" and . > 0) and
    (.backup.earliestRestoreDate | type == "string" and length > 0)
  ' <<<"$server_info" >/dev/null; then
    echo "Point-in-time restore target unavailable: server state, backup retention, or earliest restore date is invalid." >&2
    exit 1
  fi
  restore_target=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  earliest_restore=$(jq -r '.backup.earliestRestoreDate' <<<"$server_info")
  restore_server="tomoribot-pitr-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  if ! earliest_epoch=$(date -u -d "$earliest_restore" +%s) ||
     [ "$earliest_epoch" -gt "$(date -u -d "$restore_target" +%s)" ]; then
    echo "Point-in-time restore target unavailable: earliest restore point is later than the target." >&2
    exit 1
  fi
  echo "::notice title=Point-in-time restore target::${restore_target} (restore window checked)"
  {
    echo "### PostgreSQL point-in-time restore target"
    echo "Target (UTC): \`$restore_target\`"
    echo "Earliest available (UTC): \`$earliest_restore\`"
    echo "Retention: \`$(jq -r '.backup.backupRetentionDays' <<<"$server_info") days\`"
    echo 'Restore creates a new server:'
    echo '```bash'
    echo "az postgres flexible-server restore --resource-group tomoribot-rg --name $restore_server --source-server tomoribot-postgres --restore-time '$restore_target'"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

BACKUP_NAME="pre-deploy-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
echo "Creating pre-deploy Azure PostgreSQL backup: ${BACKUP_NAME}"
az postgres flexible-server backup create \
  --resource-group tomoribot-rg \
  --server-name tomoribot-postgres \
  --name "${BACKUP_NAME}"
