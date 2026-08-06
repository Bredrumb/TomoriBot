#!/usr/bin/env bash
set -euo pipefail

: "${runtimeSecretsB64:?runtimeSecretsB64 is required}"
: "${migrationSecretsB64:?migrationSecretsB64 is required}"
: "${dockerHubUsername:?dockerHubUsername is required}"
: "${dockerHubTokenB64:?dockerHubTokenB64 is required}"
: "${tomoribotImage:?tomoribotImage is required}"
: "${initializeSchema:?initializeSchema is required}"

if [ "$initializeSchema" != "true" ] && [ "$initializeSchema" != "false" ]; then
  echo "initializeSchema must be true or false." >&2
  exit 1
fi

if [[ ! "$tomoribotImage" =~ @sha256:[0-9a-f]{64}$ ]]; then
  echo "TomoriBot image must be an immutable sha256 image reference." >&2
  exit 1
fi

umask 077
stage_dir=$(mktemp -d /var/lib/waagent/tomoribot-db-bootstrap.XXXXXX)
docker_authenticated=false
cleanup() {
  rm -rf "$stage_dir"
  if [ "$docker_authenticated" = true ]; then
    docker logout docker.io >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

command -v jq >/dev/null 2>&1 || {
  echo "jq is required; install it during VM provisioning." >&2
  exit 1
}

printf '%s' "$runtimeSecretsB64" | base64 --decode >"$stage_dir/runtime-secrets.json"
printf '%s' "$migrationSecretsB64" | base64 --decode >"$stage_dir/migration-secrets.json"
printf '%s' "$dockerHubTokenB64" | base64 --decode >"$stage_dir/dockerhub-token"
chown root:1001 "$stage_dir/migration-secrets.json"
chmod 0440 "$stage_dir/migration-secrets.json"

for secret_file in runtime-secrets.json migration-secrets.json; do
  jq -e '
    type == "object" and
    (.POSTGRES_USER | type == "string" and length > 0) and
    (.POSTGRES_PASSWORD | type == "string" and length > 0) and
    (.POSTGRES_HOST | type == "string" and length > 0) and
    (.POSTGRES_PORT | type == "number" or type == "string") and
    (.POSTGRES_DB | type == "string" and length > 0)
  ' "$stage_dir/$secret_file" >/dev/null
done

runtime_user=$(jq -r '.POSTGRES_USER' "$stage_dir/runtime-secrets.json")
runtime_password=$(jq -r '.POSTGRES_PASSWORD' "$stage_dir/runtime-secrets.json")
postgres_host=$(jq -r '.POSTGRES_HOST' "$stage_dir/runtime-secrets.json")
postgres_port=$(jq -r '.POSTGRES_PORT' "$stage_dir/runtime-secrets.json")
postgres_database=$(jq -r '.POSTGRES_DB' "$stage_dir/runtime-secrets.json")
admin_user=$(jq -r '.POSTGRES_USER' "$stage_dir/migration-secrets.json")
admin_password=$(jq -r '.POSTGRES_PASSWORD' "$stage_dir/migration-secrets.json")

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
if [ "$runtime_user" = "$admin_user" ]; then
  echo "Runtime and migration database identities must be different." >&2
  exit 1
fi

docker login --username "$dockerHubUsername" --password-stdin docker.io \
  <"$stage_dir/dockerhub-token" >/dev/null
docker_authenticated=true
rm -f "$stage_dir/dockerhub-token"
docker pull "$tomoribotImage" >/dev/null
docker logout docker.io >/dev/null
docker_authenticated=false

psql_admin() {
  docker run --rm -i \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    -e PGPASSWORD="$admin_password" \
    --entrypoint psql \
    "$tomoribotImage" \
    --host "$postgres_host" \
    --port "$postgres_port" \
    --username "$admin_user" \
    --dbname "$postgres_database" \
    --set ON_ERROR_STOP=1 \
    "$@"
}

psql_admin \
  --set runtime_user="$runtime_user" \
  --set runtime_password="$runtime_password" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'runtime_user', :'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_user')
\gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'runtime_user', :'runtime_password'
)
\gexec
SQL

if [ "$initializeSchema" = "true" ]; then
  docker run --rm \
    --user 1001:1001 \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m,uid=1001,gid=1001 \
    -e RUN_ENV=production \
    -e SECRET_FILE=/run/secrets/tomoribot.json \
    -v "$stage_dir/migration-secrets.json:/run/secrets/tomoribot.json:ro" \
    "$tomoribotImage" bun run src/db/initializeCli.ts
else
  echo "Existing PostgreSQL server detected; skipping schema initialization."
fi

psql_admin --set runtime_user="$runtime_user" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL ON DATABASE %I FROM %I', current_database(), :'runtime_user')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'runtime_user')
\gexec
SELECT format('REVOKE ALL ON SCHEMA public FROM %I', :'runtime_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_user')
\gexec
SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', :'runtime_user')
\gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'runtime_user')
\gexec
SELECT format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', :'runtime_user')
\gexec
SELECT format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', :'runtime_user')
\gexec
SELECT format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', :'runtime_user')
\gexec
SELECT format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', :'runtime_user')
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'runtime_user')
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', :'runtime_user')
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I', :'runtime_user')
\gexec

SELECT 1 / CASE WHEN COALESCE((
  SELECT
    NOT rolsuper AND
    NOT rolcreatedb AND
    NOT rolcreaterole AND
    NOT rolreplication AND
    NOT rolbypassrls AND
    NOT rolinherit AND
    has_database_privilege(rolname, current_database(), 'CONNECT') AND
    NOT has_database_privilege(rolname, current_database(), 'CREATE') AND
    has_schema_privilege(rolname, 'public', 'USAGE') AND
    NOT has_schema_privilege(rolname, 'public', 'CREATE')
  FROM pg_roles
  WHERE rolname = :'runtime_user'
), false) THEN 1 ELSE 0 END AS runtime_role_baseline_verified;
SQL

echo "TomoriBot database bootstrap completed."
echo "TOMORIBOT_DATABASE_BOOTSTRAP_SUCCEEDED"
