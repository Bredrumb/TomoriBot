#!/usr/bin/env bash
set -euo pipefail
umask 077

dest=/etc/tomoribot/gcp-vertex-sa.json
tmp=$(mktemp /etc/tomoribot/.gcp-vertex-sa.XXXXXX)
trap 'rm -f "$tmp"' EXIT

cat >"$tmp"
jq -e '.type == "service_account"
  and (.client_email | endswith(".iam.gserviceaccount.com"))
  and (.private_key | startswith("-----BEGIN PRIVATE KEY-----"))' "$tmp" >/dev/null
chown root:1001 "$tmp"
chmod 0640 "$tmp"
mv -f "$tmp" "$dest"
jq -r '"Installed key \(.private_key_id) for \(.client_email)"' "$dest"
