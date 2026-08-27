#!/usr/bin/env bash
set -euo pipefail

: "${runtimeSecretsB64:?runtimeSecretsB64 is required}"
: "${vertexConfigB64:?vertexConfigB64 is required}"
: "${composeConfigB64:?composeConfigB64 is required}"
: "${dockerHubUsername:?dockerHubUsername is required}"
: "${dockerHubTokenB64:?dockerHubTokenB64 is required}"
: "${tomoribotImage:?tomoribotImage is required}"
: "${searxngImage:?searxngImage is required}"
# Optional, and doubles as the SearXNG on/off switch: the sidecar refuses to start without a
# secret, so gating the profile on the same value makes "configured" and "running" one state
# instead of two that can disagree. Absent means the bot keeps using Brave -> DDG -> Felo.
searxngSecretB64="${searxngSecretB64:-}"

require_digest() {
  local image_ref=$1
  local label=$2

  if [[ ! "$image_ref" =~ @sha256:[0-9a-f]{64}$ ]]; then
    echo "$label must be an immutable sha256 image reference." >&2
    exit 1
  fi
}

umask 077
install -d -o root -g root -m 0700 /etc/tomoribot
stage_dir=$(mktemp -d /etc/tomoribot/.deploy.XXXXXX)
docker_authenticated=false
cleanup() {
  rm -rf "$stage_dir"
  if [ "$docker_authenticated" = true ]; then
    docker logout docker.io >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

timeout 600s cloud-init status --wait >/dev/null
command -v jq >/dev/null 2>&1 || {
  echo "jq is required; install it during VM provisioning." >&2
  exit 1
}

require_digest "$tomoribotImage" "TomoriBot image"
require_digest "$searxngImage" "SearXNG image"

printf '%s' "$runtimeSecretsB64" | base64 --decode >"$stage_dir/runtime-secrets.json"
printf '%s' "$vertexConfigB64" | base64 --decode >"$stage_dir/google-vertex-wif.json"
printf '%s' "$composeConfigB64" | base64 --decode >"$stage_dir/docker-compose.yml"
printf '%s' "$dockerHubTokenB64" | base64 --decode >"$stage_dir/dockerhub-token"

jq -e '
  type == "object" and
  (.POSTGRES_USER | type == "string" and length > 0) and
  (.POSTGRES_PASSWORD | type == "string" and length > 0) and
  (.POSTGRES_HOST | type == "string" and length > 0) and
  (.POSTGRES_PORT | type == "number" or type == "string") and
  (.POSTGRES_DB | type == "string" and length > 0)
' "$stage_dir/runtime-secrets.json" >/dev/null
jq -e 'type == "object"' "$stage_dir/google-vertex-wif.json" >/dev/null

runtime_user=$(jq -r '.POSTGRES_USER' "$stage_dir/runtime-secrets.json")
postgres_host=$(jq -r '.POSTGRES_HOST' "$stage_dir/runtime-secrets.json")
if [[ ! "$runtime_user" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
  echo "Runtime database role name is invalid." >&2
  exit 1
fi
case "$runtime_user" in
  tomoriadmin | azure_pg_admin | postgres)
    echo "The runtime secret bundle contains a PostgreSQL administrator identity." >&2
    exit 1
    ;;
esac

if [[ ! "$postgres_host" =~ \.postgres\.database\.azure\.com$ ]]; then
  echo "PostgreSQL host must be the Azure Flexible Server public FQDN." >&2
  exit 1
fi

install -d -o 1001 -g 1001 -m 0750 \
  /var/log/tomoribot \
  /var/lib/tomoribot/backups \
  /var/lib/tomoribot/data
install -m 0640 -o root -g 1001 \
  "$stage_dir/runtime-secrets.json" /etc/tomoribot/.secrets.json.new
install -m 0640 -o root -g 1001 \
  "$stage_dir/google-vertex-wif.json" /etc/tomoribot/.google-vertex-wif.json.new
install -m 0644 -o root -g root \
  "$stage_dir/docker-compose.yml" /etc/tomoribot/.docker-compose.yml.new
mv -f /etc/tomoribot/.secrets.json.new /etc/tomoribot/secrets.json
mv -f /etc/tomoribot/.google-vertex-wif.json.new /etc/tomoribot/google-vertex-wif.json
mv -f /etc/tomoribot/.docker-compose.yml.new /etc/tomoribot/docker-compose.yml

docker login --username "$dockerHubUsername" --password-stdin docker.io \
  <"$stage_dir/dockerhub-token" >/dev/null
docker_authenticated=true
rm -f "$stage_dir/dockerhub-token"
docker pull "$tomoribotImage" >/dev/null
docker pull "$searxngImage" >/dev/null
docker logout docker.io >/dev/null
docker_authenticated=false

searxng_secret=""
compose_services=(tomoribot)
searxng_base_url=""
if [ -n "$searxngSecretB64" ]; then
  searxng_secret=$(printf '%s' "$searxngSecretB64" | base64 --decode)
  if [ ${#searxng_secret} -lt 32 ]; then
    echo "SEARXNG_SECRET must contain at least 32 characters." >&2
    exit 1
  fi
  compose_services+=(searxng)
  # Container-to-container over the compose network, so this never leaves the host.
  searxng_base_url="http://searxng:8080/"
fi

compose_env=(
  "TOMORIBOT_IMAGE=$tomoribotImage"
  "SEARXNG_IMAGE=$searxngImage"
  "SEARXNG_SECRET=$searxng_secret"
  "SEARXNG_BASE_URL=$searxng_base_url"
)

env "${compose_env[@]}" \
  docker compose -f /etc/tomoribot/docker-compose.yml up \
    -d --pull never --remove-orphans "${compose_services[@]}" >/dev/null

container_id=$(env "${compose_env[@]}" \
  docker compose -f /etc/tomoribot/docker-compose.yml ps -q tomoribot)
if [ -z "$container_id" ] || \
  [ "$(docker inspect --format '{{.Config.User}}' "$container_id")" != "1001:1001" ] || \
  [ "$(docker exec "$container_id" id -u)" != "1001" ] || \
  [ "$(docker exec "$container_id" id -g)" != "1001" ]; then
  echo "TomoriBot container UID/GID invariant failed." >&2
  exit 1
fi

# Verify the public PostgreSQL path with the same production client and
# certificate/hostname validation used by the application. This query also
# proves the exact-address firewall rule and runtime credentials are valid.
if ! docker exec "$container_id" bun -e '
  const secrets = await Bun.file("/run/secrets/tomoribot.json").json();
  for (const key of ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB"]) {
    process.env[key] = String(secrets[key]);
  }
  process.env.RUN_ENV = "production";
  const { sql } = await import("./src/utils/db/client.ts");
  await sql`SELECT 1`;
  await sql.close();
' >/dev/null; then
  echo "PostgreSQL public-FQDN TLS connectivity check failed." >&2
  exit 1
fi

for attempt in $(seq 1 20); do
  if curl -fsS http://localhost:8081/healthz >/dev/null; then
    break
  fi
  if [ "$attempt" -eq 20 ]; then
    echo "TomoriBot health check failed; inspect access-controlled Log Analytics logs." >&2
    exit 1
  fi
  sleep 30
done

assert_file() {
  local path=$1
  local expected_mode=$2
  local expected_owner=$3
  local expected_group=$4
  local actual

  actual=$(stat -c '%a:%u:%g' "$path")
  if [ "$actual" != "$expected_mode:$expected_owner:$expected_group" ]; then
    echo "Unexpected ownership or mode for $path: $actual" >&2
    exit 1
  fi
}

assert_file /etc/tomoribot/secrets.json 640 0 1001
assert_file /etc/tomoribot/google-vertex-wif.json 640 0 1001
assert_file /etc/tomoribot/docker-compose.yml 644 0 0

# After the health check so a failed deploy keeps the prior image for rollback. Never fatal: the
# deploy has already succeeded here, so reclaiming disk must not fail it.
docker image prune -f >/dev/null 2>&1 || echo "Image prune skipped; disk reclaim deferred." >&2

echo "TomoriBot deployment succeeded through Azure Run Command."
echo "TOMORIBOT_DEPLOYMENT_SUCCEEDED"
