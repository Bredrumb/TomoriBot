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

## Triaging a frozen bot ("Online but ignoring everything")

Run these in order. Each one invalidates the next if it fails, and the first two are cheap.

**1. Was anything actually killed?** A restarted process and a hung process need opposite fixes.

```sh
docker inspect $(docker ps -q) --format '{{.Name}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}'
journalctl -b -1 -k --no-pager | grep -iE "out of memory|killed process|oom-kill"
```

`restarts=0` with `oom=false` and no kernel OOM line means the process never died. Note that a
`swapoff` victim dated to the moment of a reboot is an artifact of that reboot tearing down zram, not
evidence about the incident. If the host was rebooted, `-b -1` is the boot that matters.

**2. Find the gap in a heartbeat metric.** `cache_sizes` emits every 5 minutes at level 52, so a
missing run of samples bounds the freeze far more precisely than any error log. The host file
outlives containers, and `hostname` is the container ID, which separates process generations across a
restart:

```sh
awk '/metric:cache_sizes/{
  if (match($0, /"time":[0-9]+/)) { t=int(substr($0, RSTART+7, RLENGTH-7)/1000) } else next;
  sod = t % 86400;
  m="?"; if (match($0, /"hostname":"[a-z0-9]+"/)) m=substr($0,RSTART+12,RLENGTH-13);
  printf "%02d:%02d ctr=%s\n", int(sod/3600), int((sod%3600)/60), m;
}' /var/log/tomoribot/tomoribot.jsonl | tail -40
```

Same container ID on both sides of a gap means one process stopped running its timers rather than
dying. `mawk` has no `strftime`, hence the manual UTC arithmetic.

**3. Ask the platform what stalled.** Guest metrics are gone once the VM reboots, but Azure keeps
these. Query the freeze window at `PT15M`:

```bash
for M in "Percentage CPU" "CPU Credits Remaining" "OS Disk Queue Depth" "OS Disk Latency" \
         "OS Disk Read Operations/Sec" "OS Disk Write Operations/Sec" "Available Memory Bytes"; do
  az monitor metrics list --resource tomoribot-vm --resource-group tomoribot-rg \
    --resource-type Microsoft.Compute/virtualMachines --metrics "$M" \
    --start-time <start>Z --end-time <end>Z --interval PT15M --aggregation Average -o table
done
```

`az monitor metrics list` rejects a full resource ID in the installed extension; pass the
name/group/type triple instead. Interpretation:

| Pattern | Meaning |
|---|---|
| Queue depth and latency spike, CPU flat, credits untouched | Storage stall, not compute. Not a burstable throttle. |
| Reads climb while writes fall | Clean file-backed reclaim thrash, so the binary's own text is being evicted and re-faulted. |
| Available memory pinned flat for the whole window | Reclaim equilibrium. The OOM killer will not fire, because reclaim keeps succeeding. |
| Burst IO credits at 0% | Rules out disk throttling as the cause. |

A flat memory plateau with a storage stall and no kill is the zram livelock described in
[Azure Production Deployment](/architecture/cloud/azure-production-deployment/). **There is currently
no automatic recovery from it**, so clearing one means restarting the container or the VM by hand.

Before concluding a freeze is that livelock, rule out the opposite failure. A restart *loop* also
presents as an unresponsive bot, and the two need opposite responses:

```sh
docker inspect tomoribot-azure-tomoribot-1 --format 'restarts={{.RestartCount}} health={{.State.Health.Status}}'
systemctl is-active earlyoom systemd-oomd
```

A climbing `RestartCount` means something is killing the process, not that it is hung. An OOM daemon
configured against instantaneous `MemAvailable` will do exactly this on a host this small, because a
warming cache dips into the same range a livelock sits in; see the deployment page for why that
approach was reverted.
