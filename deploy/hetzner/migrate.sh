#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
cd /etc/tomoribot
set -a
. ./.env
set +a
[[ "$TOMORIBOT_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || {
  echo "An immutable TomoriBot image digest is required." >&2; exit 1;
}
[[ -z "$(docker ps -q --filter label=com.docker.compose.project=tomoribot --filter label=com.docker.compose.service=tomoribot)" ]] || {
  echo "Stop the gateway and its watchdog timers before migrating." >&2; exit 1;
}
for timer in tomoribot-watchdog.timer tomoribot-restart.timer; do
  if systemctl is-active --quiet "$timer"; then
    echo "Stop $timer before migrating." >&2; exit 1;
  fi
done
check_only=false
check_args=()
if [[ ${1:-} == --check ]]; then
  check_only=true
  shift
  [[ $# -eq 0 || ( $# -eq 1 && $1 == --recovery-point-opt-in ) ]] || exit 1
  check_args=("$@")
elif [[ $# -ne 0 ]]; then
  exit 1
fi
schema_args=()
billing=$(jq -r '.TOMORI_SUPPORTER_BILLING_ENABLED // false | tostring' secrets.json)
case "$billing" in
  true) schema_args+=(--supporter-billing) ;;
  false) ;;
  *) echo "Invalid supporter billing flag." >&2; exit 1 ;;
esac
job=(bun run src/db/initializeCli.ts "${schema_args[@]}")
if [[ "$check_only" == true ]]; then
  job=(bun -e '
    const { loadDatabaseSecretsFromFile } = await import("./src/utils/db/databaseSecrets.ts");
    await loadDatabaseSecretsFromFile(process.env.SECRET_FILE);
    process.argv = ["bun", "checkPendingMigrations.ts", "--allow-downtime", ...process.argv.slice(1)];
    await import("./scripts/checks/checkPendingMigrations.ts");
  ' -- "${check_args[@]}")
fi
docker run --rm --network none --user 1001:1001 --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 512m --memory-swap 512m --pids-limit 256 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m,uid=1001,gid=1001 \
  -e RUN_ENV=production -e SECRET_FILE=/run/secrets/tomoribot.json \
  -v /etc/tomoribot/admin-secrets.json:/run/secrets/tomoribot.json:ro \
  --mount type=volume,src=tomoribot-pgsocket,dst=/var/run/postgresql,readonly,volume-nocopy \
  "$TOMORIBOT_IMAGE" "${job[@]}"
if [[ "$check_only" == false ]]; then
  docker exec -i -u postgres tomoribot-postgres psql -X -q -v ON_ERROR_STOP=1 -d tomoribot < postgres/grants.sql
fi
