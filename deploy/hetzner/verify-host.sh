#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
cd /etc/tomoribot
docker compose config --quiet
docker compose ps
docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}'
free -m
swapon --show
cat /proc/pressure/memory /proc/pressure/io
docker exec -i -u postgres tomoribot-postgres psql -X -v ON_ERROR_STOP=1 -d tomoribot <<'SQL'
SELECT 1 / CASE WHEN current_setting('listen_addresses') = '' THEN 1 ELSE 0 END AS socket_only;
SELECT extname, extversion FROM pg_extension ORDER BY extname;
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
SQL
docker inspect tomoribot-postgres --format 'network={{.HostConfig.NetworkMode}} memory={{.HostConfig.Memory}} memory_swap={{.HostConfig.MemorySwap}}'
docker exec -u postgres tomoribot-postgres pg_isready -h /var/run/postgresql -d tomoribot
echo "Host checks complete; staging, restore, off-site backup, and HTTPS checks are separate cutover gates."
