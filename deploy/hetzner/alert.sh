#!/usr/bin/env bash
set -euo pipefail
body=$(jq -n --arg unit "$1" --arg host "$(hostname)" \
  '{content: "\($host): \($unit) failed. Run journalctl -u \($unit) on the host."}')
curl -fsS --max-time 10 --config /etc/tomoribot/alert-webhook.curl \
  -H 'Content-Type: application/json' --data "$body" >/dev/null
