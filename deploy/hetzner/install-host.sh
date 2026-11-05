#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
install -d -m 0700 /etc/tomoribot /etc/tomoribot/postgres /etc/tomoribot/backup
install -m 0644 docker-compose.yml Caddyfile /etc/tomoribot/
install -m 0644 postgres/Dockerfile postgres/postgresql.conf postgres/pg_hba.conf /etc/tomoribot/postgres/
install -m 0600 postgres/roles.sql postgres/grants.sql postgres/rowcounts.sql /etc/tomoribot/postgres/
for script in bootstrap migrate verify-host; do
  install -m 0700 "$script.sh" "/etc/tomoribot/$script.sh"
done
install -m 0755 backup.sh /usr/local/bin/tomoribot-backup.sh
install -m 0755 alert.sh /usr/local/sbin/tomoribot-alert
install -m 0755 install-vertex-key.sh /usr/local/sbin/tomoribot-install-vertex-key
install -m 0644 systemd/* /etc/systemd/system/
python3 - ../../terraform/azure/cloud-init.yaml <<'PY'
import pathlib
import sys
import yaml

wanted = {
  "/etc/tomoribot/watchdog.conf",
  "/usr/local/sbin/tomoribot-progress-watchdog.sh",
  "/usr/local/sbin/tomoribot-scheduled-restart.sh",
  "/etc/systemd/system/tomoribot-watchdog.service",
  "/etc/systemd/system/tomoribot-watchdog.timer",
  "/etc/systemd/system/tomoribot-restart.service",
  "/etc/systemd/system/tomoribot-restart.timer",
}
entries = yaml.safe_load(pathlib.Path(sys.argv[1]).read_text())["write_files"]
selected = {entry["path"]: entry for entry in entries if entry["path"] in wanted}
if selected.keys() != wanted:
  raise SystemExit("The Azure watchdog source is incomplete.")
for name, entry in selected.items():
  target = pathlib.Path(name)
  if name.endswith("watchdog.conf") and target.exists():
    continue
  content = entry["content"].replace("WATCHDOG_ARMED=true", "WATCHDOG_ARMED=false")
  target.write_text(content)
  target.chmod(int(entry["permissions"], 8))
PY
systemctl daemon-reload
echo "Files installed; gateway and timers remain stopped."
