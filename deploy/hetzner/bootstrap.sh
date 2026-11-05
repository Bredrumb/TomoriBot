#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
cd /etc/tomoribot
umask 077
for file in admin-secrets.json secrets.db.json postgres/superuser-password backup/pgpass; do
  [[ ! -e "$file" ]] || { echo "Existing database credentials found; refusing to replace them." >&2; exit 1; }
done
[[ -z "$(find /var/lib/tomoribot/postgres -mindepth 1 -maxdepth 1 -print -quit)" ]] || {
  echo "Existing database data found; use the restore runbook." >&2; exit 1;
}
docker compose config --quiet
openssl rand -hex 32 > postgres/superuser-password
chown 999:999 postgres/superuser-password
chmod 0400 postgres/superuser-password
docker compose build postgres
docker compose pull --policy missing searxng
docker compose up -d --wait postgres searxng
export ADMIN_PW RUNTIME_PW BACKUP_PW
ADMIN_PW=$(openssl rand -hex 32)
RUNTIME_PW=$(openssl rand -hex 32)
BACKUP_PW=$(openssl rand -hex 32)
{
  printf '\\set admin_pw %s\n\\set runtime_pw %s\n\\set backup_pw %s\n' "$ADMIN_PW" "$RUNTIME_PW" "$BACKUP_PW"
  cat postgres/roles.sql postgres/grants.sql
} | docker exec -i -u postgres tomoribot-postgres psql -X -q -v ON_ERROR_STOP=1 -d tomoribot
jq -n '{POSTGRES_HOST:"/var/run/postgresql",POSTGRES_PORT:"5432",POSTGRES_DB:"tomoribot",POSTGRES_USER:"tomoriadmin",POSTGRES_PASSWORD:env.ADMIN_PW}' > admin-secrets.json
jq -n '{POSTGRES_HOST:"/var/run/postgresql",POSTGRES_PORT:"5432",POSTGRES_DB:"tomoribot",POSTGRES_USER:"tomoribot_runtime",POSTGRES_PASSWORD:env.RUNTIME_PW}' > secrets.db.json
chown root:1001 admin-secrets.json
chmod 0440 admin-secrets.json
printf '*:5432:*:tomori_backup:%s\n' "$BACKUP_PW" > backup/pgpass
chmod 0600 backup/pgpass secrets.db.json
unset ADMIN_PW RUNTIME_PW BACKUP_PW
echo "Database roles initialized; no gateway was started."
