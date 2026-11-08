#!/usr/bin/env bash
set -euo pipefail
umask 077

dest=/etc/tomoribot/cloudflared-token
tmp=$(mktemp /etc/tomoribot/.cloudflared-token.XXXXXX)
trap 'rm -f "$tmp"' EXIT

tr -d '[:space:]' >"$tmp"
tunnel_id=$(base64 -d <"$tmp" | jq -er 'select(.a and .s and .t) | .t')
chown 65532:65532 "$tmp"
chmod 0400 "$tmp"
mv -f "$tmp" "$dest"
echo "Installed token for tunnel $tunnel_id"
