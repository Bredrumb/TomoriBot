#!/usr/bin/env bash
set -euo pipefail
[[ ! -e /etc/tomoribot/provider-fenced ]] || exit 1
[[ "$expectedImageDigest" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
[[ "$sqlSha256" =~ ^[0-9a-f]{64}$ ]] || exit 1

mapfile -t containers < <(docker ps -q --filter label=com.docker.compose.service=tomoribot)
[[ ${#containers[@]} -gt 0 ]] || exit 1
image=""
for container in "${containers[@]}"; do
  current_image=$(docker inspect --format '{{.Config.Image}}' "$container")
  [[ "$current_image" == *"@$expectedImageDigest" ]] || exit 1
  [[ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" == healthy ]] || exit 1
  image="$current_image"
done

umask 077
stage_dir=$(mktemp -d /var/lib/waagent/tomoribot-sql.XXXXXX)
cleanup() {
  if [ -f "$stage_dir/container-id" ]; then
    docker rm -f "$(cat "$stage_dir/container-id")" >/dev/null 2>&1 || true
  fi
  rm -rf "$stage_dir"
}
trap cleanup EXIT
printf '%s' "$migrationSecretsB64" | base64 --decode > "$stage_dir/connection.json"
printf '%s' "$sqlB64" | base64 --decode > "$stage_dir/query.sql"
printf '%s' "$executorB64" | base64 --decode > "$stage_dir/executor.ts"
[[ "$(sha256sum "$stage_dir/query.sql" | cut -d ' ' -f 1)" == "$sqlSha256" ]] || exit 1
jq -e --slurpfile runtime /etc/tomoribot/secrets.json '
  .POSTGRES_HOST == $runtime[0].POSTGRES_HOST and
  (.POSTGRES_PORT | tostring) == ($runtime[0].POSTGRES_PORT | tostring) and
  .POSTGRES_DB == $runtime[0].POSTGRES_DB and
  .POSTGRES_USER != $runtime[0].POSTGRES_USER
' "$stage_dir/connection.json" >/dev/null
chown root:1001 "$stage_dir/connection.json" "$stage_dir/query.sql" "$stage_dir/executor.ts"
chmod 0440 "$stage_dir/connection.json" "$stage_dir/query.sql" "$stage_dir/executor.ts"

if ! timeout 120 docker run --rm --pull never \
  --cidfile "$stage_dir/container-id" \
  --user 1001:1001 --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 256m --memory-swap 256m --pids-limit 64 --cpus 0.5 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,uid=1001,gid=1001 \
  -e "SQL_SHA256=$sqlSha256" \
  -v "$stage_dir/connection.json:/run/maintenance/connection.json:ro" \
  -v "$stage_dir/query.sql:/run/maintenance/query.sql:ro" \
  -v "$stage_dir/executor.ts:/app/scripts/maintenance/sqlOperation.ts:ro" \
  "$image" bun run scripts/maintenance/sqlOperation.ts execute >"$stage_dir/operation.log" 2>&1; then
  echo TOMORIBOT_SQL_MAINTENANCE_FAILED
  exit 1
fi
echo TOMORIBOT_SQL_MAINTENANCE_SUCCEEDED
