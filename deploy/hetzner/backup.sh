#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
exec 9>/var/backups/tomoribot/.backup.lock
flock -n 9

. /etc/tomoribot/backup/backup.env
: "${STORAGEBOX_HOST:?}" "${STORAGEBOX_USER:?}" "${GPG_RECIPIENT:?}"

export PGHOST=/var/lib/docker/volumes/tomoribot-pgsocket/_data
export PGPORT=5432 PGDATABASE=tomoribot PGUSER=tomori_backup
export PGPASSFILE=/etc/tomoribot/backup/pgpass
export GNUPGHOME=/var/lib/tomoribot-backup/gnupg
export RCLONE_CONFIG_SBOX_TYPE=sftp
export RCLONE_CONFIG_SBOX_HOST="$STORAGEBOX_HOST"
export RCLONE_CONFIG_SBOX_USER="$STORAGEBOX_USER"
export RCLONE_CONFIG_SBOX_PORT=23
export RCLONE_CONFIG_SBOX_KEY_FILE=/etc/tomoribot/backup/storagebox_ed25519
export RCLONE_CONFIG_SBOX_KNOWN_HOSTS_FILE=/etc/tomoribot/backup/storagebox_known_hosts
export RCLONE_CONFIG_SBOX_SHELL_TYPE=none

readonly LOCAL_DIR=/var/backups/tomoribot
readonly KEEP_HOURLY=24 KEEP_DAILY=7 KEEP_WEEKLY=4 KEEP_LOCAL=2
readonly DRILL_DB=tomoribot_restore_drill
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
readonly STAMP
readonly NAME="tomoribot-$STAMP"
STAGE=$(mktemp -d "$LOCAL_DIR/.stage-XXXXXX")
readonly STAGE
trap 'rm -rf "$STAGE"' EXIT

log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

app_image=$(sed -n 's/^TOMORIBOT_IMAGE=//p' /etc/tomoribot/.env)
[ -n "$app_image" ]

run_audit() {
  docker run --rm --network none --user 1001:1001 --read-only --cap-drop ALL \
    --memory 512m --memory-swap 512m --pids-limit 128 \
    --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,uid=1001,gid=1001 \
    -e RUN_ENV=production -e SECRET_FILE=/run/secrets/tomoribot.json \
    -v "$1:/run/secrets/tomoribot.json:ro" \
    --mount type=volume,src=tomoribot-pgsocket,dst=/var/run/postgresql,readonly,volume-nocopy \
    "$app_image" bun run audit-keys
}

psql_su() { docker exec -i -u postgres tomoribot-postgres psql -X -q -v ON_ERROR_STOP=1 "$@"; }

restore_drill() {
  log "Restore drill into $DRILL_DB"
  psql_su -d postgres -c "DROP DATABASE IF EXISTS $DRILL_DB WITH (FORCE)" || return 1
  psql_su -d postgres -c "CREATE DATABASE $DRILL_DB OWNER tomoriadmin" || return 1
  psql_su -d "$DRILL_DB" -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;" || return 1
  grep -v -E ' EXTENSION - | COMMENT - EXTENSION |TABLE DATA cron ' "$STAGE/db.toc" >"$STAGE/drill.list" || return 1
  jq -r '"*:5432:*:tomoriadmin:\(.POSTGRES_PASSWORD)"' /etc/tomoribot/admin-secrets.json >"$STAGE/admin.pgpass" || return 1
  PGPASSFILE="$STAGE/admin.pgpass" pg_restore --dbname "$DRILL_DB" --username tomoriadmin \
    --no-owner --no-acl --exit-on-error --single-transaction \
    --use-list "$STAGE/drill.list" "$STAGE/db.dump" || return 1
  psql_su -d "$DRILL_DB" <<SQL || return 1
GRANT CONNECT ON DATABASE $DRILL_DB TO tomoribot_runtime;
GRANT USAGE ON SCHEMA public TO tomoribot_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO tomoribot_runtime;
SQL
  jq --arg db "$DRILL_DB" '.POSTGRES_DB = $db' /etc/tomoribot/secrets.json >"$STAGE/drill-secrets.json" || return 1
  chgrp 1001 "$STAGE/drill-secrets.json" || return 1
  chmod 0640 "$STAGE/drill-secrets.json" || return 1

  local rc=0 live restored
  run_audit "$STAGE/drill-secrets.json" || rc=$?
  live=$(psql -XAtc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'") || return 1
  restored=$(psql_su -d "$DRILL_DB" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'") || return 1
  psql_su -d postgres -c "DROP DATABASE $DRILL_DB WITH (FORCE)" || return 1
  log "Drill: audit exit $rc, public tables live=$live restored=$restored"
  [ "$rc" -eq 0 ] && [ "$live" = "$restored" ]
}

prune() {
  local dir=$1 keep=$2 old
  rclone lsf --files-only --include 'tomoribot-*.tar.gpg' "sbox:$dir" | sort -r | tail -n +"$((keep + 1))" |
    while IFS= read -r old; do
      [[ "$old" =~ ^tomoribot-[0-9]{8}T[0-9]{6}Z\.tar\.gpg$ ]] || return 1
      log "Pruning $dir/$old"
      rclone deletefile "sbox:$dir/$old"
      rclone deletefile "sbox:$dir/${old%.tar.gpg}.sha256" || true
    done
}

audit_failed=0
drill_failed=0

log "Auditing encrypted columns on the live database"
if ! run_audit /etc/tomoribot/secrets.json; then
  audit_failed=1
  log "ERROR: encrypted-column audit failed; continuing so today's backup still exists"
fi

log "Dumping $PGDATABASE"
pg_dump --format=custom --compress=6 --no-password --exclude-schema=cron --lock-wait-timeout=120000 --file "$STAGE/db.dump"
pg_restore --list "$STAGE/db.dump" >"$STAGE/db.toc"
grep -q ' TABLE DATA public users ' "$STAGE/db.toc"

install -m 0600 /etc/tomoribot/secrets.json "$STAGE/runtime-secrets.json"
log "Archiving local file storage"
tar_rc=0
tar --create --gzip --file "$STAGE/data.tar.gz" --directory /var/lib/tomoribot data || tar_rc=$?
[ "$tar_rc" -le 1 ]
# Live uploads can change during archiving, so a changed-file result preserves older backups and fails verification.
if [ "$tar_rc" -ne 0 ]; then
  log "Local files changed during archiving; keeping older backups"
fi

if [ "$(date -u +%u-%H)" = 7-03 ]; then
  restore_drill || drill_failed=1
fi

{
  echo "created_utc=$STAMP"
  echo "app_image=$app_image"
  echo "server_version=$(psql -XAtc 'SHOW server_version')"
  echo "encryption_audit=$([ "$audit_failed" -eq 0 ] && echo pass || echo FAIL)"
  echo "file_archive_exit=$tar_rc"
  (cd "$STAGE" && sha256sum db.dump data.tar.gz runtime-secrets.json)
} >"$STAGE/MANIFEST"

log "Encrypting to $GPG_RECIPIENT"
tar --create --file - --directory "$STAGE" MANIFEST db.dump data.tar.gz runtime-secrets.json |
  gpg --batch --yes --no-tty --trust-model always --recipient "$GPG_RECIPIENT" \
    --compress-algo none --encrypt --output "$STAGE/$NAME.tar.gpg"
(cd "$STAGE" && sha256sum "$NAME.tar.gpg" >"$NAME.sha256")

log "Uploading to the Storage Box"
for dir in hourly daily weekly; do rclone mkdir "sbox:$dir"; done
rclone copyto "$STAGE/$NAME.tar.gpg" "sbox:hourly/$NAME.tar.gpg"
rclone copyto "$STAGE/$NAME.sha256" "sbox:hourly/$NAME.sha256"
rclone copyto "sbox:hourly/$NAME.tar.gpg" "$STAGE/roundtrip.tar.gpg"
cmp "$STAGE/$NAME.tar.gpg" "$STAGE/roundtrip.tar.gpg"
if [ "$(date -u +%H)" = 03 ]; then
  rclone copyto "$STAGE/$NAME.tar.gpg" "sbox:daily/$NAME.tar.gpg"
  rclone copyto "$STAGE/$NAME.sha256" "sbox:daily/$NAME.sha256"
  if [ "$(date -u +%u)" -eq 7 ]; then
    rclone copyto "$STAGE/$NAME.tar.gpg" "sbox:weekly/$NAME.tar.gpg"
    rclone copyto "$STAGE/$NAME.sha256" "sbox:weekly/$NAME.sha256"
  fi
fi

if [ "$audit_failed" -eq 0 ] && [ "$drill_failed" -eq 0 ] && [ "$tar_rc" -eq 0 ]; then
  prune hourly "$KEEP_HOURLY"
  prune daily "$KEEP_DAILY"
  prune weekly "$KEEP_WEEKLY"
else
  log "Skipping remote pruning because a verification step failed"
fi

mv "$STAGE/$NAME.tar.gpg" "$STAGE/$NAME.sha256" "$LOCAL_DIR/"
find "$LOCAL_DIR" -maxdepth 1 -name 'tomoribot-*.tar.gpg' -printf '%f\n' | sort -r | tail -n +"$((KEEP_LOCAL + 1))" |
  while IFS= read -r old; do rm -f "$LOCAL_DIR/$old" "$LOCAL_DIR/${old%.tar.gpg}.sha256"; done

log "Backup $NAME complete (audit_failed=$audit_failed drill_failed=$drill_failed file_archive_exit=$tar_rc)"
exit $((audit_failed | drill_failed | tar_rc))
