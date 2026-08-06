---
title: "Azure Production Data Inspection"
sidebar:
  label: "Production Data Inspection"
  hidden: true
aiGenerated: false
---

:::caution[Operator runbook]
This page targets the single TomoriBot production VM and its mounted secret file. The resource names
and container name below are literal, not placeholders, because this is a runbook rather than a
guide. Self-hosters should read
[Azure Production Deployment](/architecture/cloud/azure-production-deployment/) instead.
:::

Host lockdown removes every inbound NSG allow rule, so `ssh` cannot reach the VM and the PostgreSQL
firewall does not admit an operator workstation. Ad-hoc production queries therefore run **inside the
bot container, driven through VM Run Command**. This is the supported path for incident triage; do
not reopen SSH or widen the database firewall for it.

Credentials are not in the container environment: Compose mounts them as a JSON secret file at
`SECRET_FILE=/run/secrets/tomoribot.json`, so `docker exec … env` shows empty `POSTGRES_*`. Read them
from that file. The container root filesystem is read-only, so `docker cp` fails; pass the script on
stdin instead. Write the query as a local file, base64 it to survive Run Command's shell quoting, and
decode it into the host's `/tmp`:

```bash
# probe.js — uses Bun.SQL directly; the app's own client.ts is not importable via `bun -e`
cat > probe.js <<'EOF'
const s = await Bun.file(process.env.SECRET_FILE).json();
const sql = new Bun.SQL({
  hostname: s.POSTGRES_HOST, port: Number(s.POSTGRES_PORT || 5432),
  username: s.POSTGRES_USER, password: s.POSTGRES_PASSWORD,
  database: s.POSTGRES_DB, tls: { rejectUnauthorized: true },
});
console.log(JSON.stringify(await sql`SELECT ...`, null, 2));
await sql.end();
EOF

B64=$(base64 -w0 probe.js)
printf 'echo %s | base64 -d > /tmp/probe.js\ndocker exec -i tomoribot-azure-tomoribot-1 bun -e "$(cat /tmp/probe.js)"\n' "$B64" > run.sh

az vm run-command invoke -g tomoribot-rg -n tomoribot-vm \
  --command-id RunShellScript --scripts @run.sh \
  --query "value[0].message" -o tsv
```

Notes that save a round trip:

- `tls: { rejectUnauthorized: true }` is required; a bare `tls: true` fails with
  `ERR_POSTGRES_CONNECTION_CLOSED`.
- `az` lives at `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin` and may need adding to `PATH`
  inside a tool shell.
- The same wrapper reaches the Discord REST API using `s.DISCORD_TOKEN`, which is how a
  `channel_disc_id` or bot-authored message is resolved to a real channel or user during triage.
- Keep these scripts read-only. Route writes through a migration or an explicitly confirmed
  one-off, never through casual triage.

## Host memory and swap forensics

Azure Monitor collects neither `/proc/pressure/*` nor `vmstat` swap rates, and
`process.memoryUsage().rss` counts only resident pages, so it understates commitment on a swapping
host. Diagnosing memory pressure therefore needs the same Run Command path. Write `mem-triage.sh`:

```sh
echo "=== HOST MEMORY ==="; free -m
echo "=== SWAP ACTIVITY (si/so nonzero = active thrash) ==="; vmstat 2 5
echo "=== PSI MEMORY ==="; cat /proc/pressure/memory
echo "=== PER-PROCESS SWAP (top 5) ==="
for p in /proc/[0-9]*; do s=$(awk '/VmSwap/{print $2}' $p/status 2>/dev/null); n=$(cat $p/comm 2>/dev/null); [ -n "$s" ] && [ "$s" != "0" ] && echo "$s $n"; done | sort -rn | head -5
echo "=== CONTAINERS ==="; docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}'
echo "=== EFFECTIVE LIMIT ==="; docker inspect $(docker ps -q --filter name=tomoribot) --format 'mem_limit={{.HostConfig.Memory}}'
```

```bash
az vm run-command invoke -g tomoribot-rg -n tomoribot-vm \
  --command-id RunShellScript --scripts @mem-triage.sh \
  --query "value[0].message" -o tsv
```

Read `si`/`so` rather than swap *used*: a large `swpd` with zero `si`/`so` is cold pages evicted once
and never needed again, which is harmless. Sustained nonzero `si` means the working set is genuinely
oversubscribed. `/proc/pressure/memory` confirms it independently by measuring stall time, where
`full` is the share of wall time every task was blocked.
