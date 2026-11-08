#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 1 ]] || exit 1
stage=$(realpath -e "$1")
[[ "$stage" == /var/lib/tomoribot-deploy/.request-* ]] || exit 1
cd /etc/tomoribot
readonly state=/var/lib/tomoribot-deploy
readonly recovery="$state/recovery"
[[ ! -e "$state/recovery-required" ]] || {
  echo "Resolve the previous deployment's recovery state first." >&2; exit 1;
}
exec 8>"$state/lifecycle.lock"
flock -n 8
app_image=$(jq -er '.app_image' "$stage/request.json")
search_image=$(jq -er '.search_image' "$stage/request.json")
for image in "$app_image" "$search_image"; do
  [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || exit 1
done
export DOCKER_CONFIG=/etc/tomoribot/deploy/docker-config
docker pull "$app_image"
docker pull "$search_image"
docker compose --profile gateway pull cloudflared
for image in "$app_image" "$search_image"; do
  [[ $(docker image inspect --format '{{.Architecture}}' "$image") == arm64 ]] || exit 1
done
docker compose config --quiet
install -d -m 0700 "$recovery"
install -m 0600 .env "$recovery/previous.env"
install -m 0600 secrets.json "$recovery/previous-secrets.json"
install -m 0600 "$stage/request.json" "$recovery/request.json"
: >"$recovery/active-timers"
: >"$recovery/enabled-timers"
for timer in tomoribot-watchdog.timer tomoribot-restart.timer tomoribot-backup.timer; do
  if systemctl is-active --quiet "$timer"; then
    echo "$timer" >>"$recovery/active-timers"
  fi
  if systemctl is-enabled --quiet "$timer"; then
    echo "$timer" >>"$recovery/enabled-timers"
  fi
done
app_was_running=$(docker inspect --format '{{.State.Running}}' tomoribot-app 2>/dev/null || true)
tunnel_id=$(docker compose --profile gateway ps -q cloudflared)
phase=preparing

health() {
  curl -fsS --max-time 5 http://127.0.0.1:8081/healthz |
    jq -e '.status == "healthy" and .discord.connected == true and .discord.shardCount == 4 and
      ([.discord.shards[].id] | sort) == [0,1,2,3] and
      all(.discord.shards[]; .ready == true and (.ping | type == "number" and . >= 0 and . <= 5000))' >/dev/null
}

wait_health() {
  local _attempt
  for _attempt in {1..30}; do
    if health; then return 0; fi
    sleep 10
  done
  return 1
}

resume_timers() {
  local timer
  while IFS= read -r timer; do systemctl enable "$timer" || return 1; done <"$recovery/enabled-timers"
  while IFS= read -r timer; do systemctl start "$timer" || return 1; done <"$recovery/active-timers"
}

stop_gateway() {
  local container
  for container in $(docker compose --profile gateway ps -aq tomoribot cloudflared); do
    docker update --restart=no "$container" >/dev/null
  done
  docker compose --profile gateway stop -t 40 cloudflared tomoribot
}

recover_previous() {
  install -m 0600 "$recovery/previous.env" .env || return 1
  install -o root -g 1001 -m 0640 "$recovery/previous-secrets.json" secrets.json || return 1
  if [[ "$app_was_running" == true ]]; then
    docker compose --profile gateway up -d --pull never --no-deps --force-recreate tomoribot || return 1
    wait_health || return 1
  fi
  if [[ -n "$tunnel_id" ]]; then
    docker compose --profile gateway up -d --pull never --no-deps --force-recreate --wait --wait-timeout 120 cloudflared || return 1
  fi
  resume_timers
}

failed() {
  local rc=$?
  trap - EXIT
  set +e
  if [[ $rc -eq 0 ]]; then return; fi
  if [[ "$phase" == migrating || "$phase" == verifying || "$phase" == complete ]]; then
    printf '%s\n' "$phase" >"$state/recovery-required"
    systemctl disable --now tomoribot-watchdog.timer tomoribot-restart.timer tomoribot-backup.timer || true
    systemctl stop tomoribot-watchdog.service tomoribot-restart.service || true
    stop_gateway || true
    echo "Schema may have changed; gateway and timers remain stopped until operator recovery." >&2
  else
    if recover_previous; then
      rm -f "$state/recovery-required"
    else
      echo recovery >"$state/recovery-required"
      systemctl disable --now tomoribot-watchdog.timer tomoribot-restart.timer tomoribot-backup.timer || true
      stop_gateway || true
    fi
  fi
  exit "$rc"
}
trap failed EXIT
trap 'exit 1' TERM INT HUP
echo preparing >"$state/recovery-required"
systemctl disable --now tomoribot-watchdog.timer tomoribot-restart.timer tomoribot-backup.timer
systemctl stop tomoribot-watchdog.service tomoribot-restart.service
case $(systemctl show -p ActiveState --value tomoribot-backup.service) in
  inactive | failed) ;;
  *) echo "An off-site backup is already running; retry after it completes." >&2; exit 1 ;;
esac
stop_gateway
phase=stopped
systemctl start tomoribot-backup.service
[[ $(systemctl show -p Result --value tomoribot-backup.service) == success ]]
latest=$(find /var/backups/tomoribot -maxdepth 1 -name 'tomoribot-*.sha256' -printf '%f\n' | sort -r | head -1)
[[ -n "$latest" ]]
(cd /var/backups/tomoribot && sha256sum --check "$latest")
printf '%s\n' "$latest" >"$recovery/backup-checksum"
python3 - "$app_image" "$search_image" <<'PY'
from pathlib import Path
import re
import sys

target = Path(".env")
content = target.read_text()
for key, value in zip(("TOMORIBOT_IMAGE", "SEARXNG_IMAGE"), sys.argv[1:]):
    content, count = re.subn(rf"(?m)^{key}=.*$", f"{key}={value}", content)
    if count != 1:
        raise SystemExit("Expected one image setting in the host environment.")
Path(".env.new").write_text(content)
Path(".env.new").replace(target)
PY
install -o root -g 1001 -m 0640 "$stage/secrets.json" .secrets.new
mv -f .secrets.new secrets.json
gate_args=(--check)
if [[ $(jq -r '.recovery_point_opt_in' "$stage/request.json") == true ]]; then
  gate_args+=(--recovery-point-opt-in)
fi
bash migrate.sh "${gate_args[@]}"
phase=migrating
echo migrating >"$state/recovery-required"
bash migrate.sh
docker run --rm --network none --user 1001:1001 --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 512m --memory-swap 512m --pids-limit 128 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,uid=1001,gid=1001 \
  -e RUN_ENV=production -e SECRET_FILE=/run/secrets/tomoribot.json \
  -v /etc/tomoribot/secrets.json:/run/secrets/tomoribot.json:ro \
  --mount type=volume,src=tomoribot-pgsocket,dst=/var/run/postgresql,readonly,volume-nocopy \
  "$app_image" bun run audit-keys
phase=verifying
printf 'services:\n  tomoribot:\n    restart: "no"\n  cloudflared:\n    restart: "no"\n' >"$state/no-restart.yml"
docker compose --profile gateway up -d --pull never --no-deps --force-recreate --wait --wait-timeout 180 searxng
docker compose -f docker-compose.yml -f "$state/no-restart.yml" --profile gateway up -d --pull never --no-deps --force-recreate tomoribot
[[ $(docker inspect --format '{{.Image}}' tomoribot-app) == "$(docker image inspect --format '{{.Id}}' "$app_image")" ]]
[[ $(docker inspect --format '{{.Config.User}}' tomoribot-app) == 1001:1001 ]]
started_at=$(docker inspect --format '{{.State.StartedAt}}' tomoribot-app)
wait_health
for _observation in {1..12}; do
  sleep 5
  health
  [[ $(docker inspect --format '{{.State.StartedAt}}:{{.RestartCount}}:{{.State.OOMKilled}}' tomoribot-app) == "$started_at:0:false" ]]
done
docker compose -f docker-compose.yml -f "$state/no-restart.yml" --profile gateway up -d --pull never --no-deps --force-recreate --wait --wait-timeout 120 cloudflared
rm -f "$state/recovery-required"
docker update --restart=unless-stopped tomoribot-app "$(docker compose --profile gateway ps -q cloudflared)" >/dev/null
resume_timers
phase=complete
docker image prune -a -f >/dev/null 2>&1 || echo "Image cleanup deferred." >&2
echo "Deployment verified: immutable image, runtime credential audit, four shards, and tunnel readiness."
