---
title: Azure Application Logs
sidebar:
  order: 1
---

If you host TomoriBot on an Azure VM, you can ship the bot's structured error logs into an
Azure Log Analytics workspace and build Grafana error panels on top of them. This page covers
the whole pipeline: the bot-side JSONL file output, the Azure Monitor Agent ingestion, and the
operational rules that keep ingestion reliable and cheap.

For monitoring a local instance with Grafana instead, see
[Local Grafana Monitoring](/self-hosting/local-monitoring/).

## Pipeline overview

```text
Pino structured logs (level >= 50 in production)
  -> /app/logs/tomoribot.jsonl in the container   (TOMORI_LOG_FILE)
  -> /var/log/tomoribot/tomoribot.jsonl on the VM (bind mount)
  -> Azure Monitor Agent "Custom Text Logs" data source
  -> Data collection rule (DCR) parses each RawData line with parse_json()
  -> Log Analytics custom table (e.g. TomoriBotLogs_CL)
  -> Grafana error panels
```

The DCR uses **Custom Text Logs**, not Custom JSON Logs. The file is UTF-8 JSONL, but
production error records contain nested `err` and `context` objects; collecting each line as a
single `RawData` string and parsing it inside the DCR transform is the reliable
Azure-supported route for nested JSON.

## Step 1: Enable the JSONL file output

Set `TOMORI_LOG_FILE` to a writable path inside the container:

```sh
TOMORI_LOG_FILE=/app/logs/tomoribot.jsonl
```

Behavior:

- Only active in JSON output mode (production, or any run without the `pino-pretty` dev
  transport). Development pretty-printing is unchanged and ignores the variable.
- Every emitted record is written to **both** stdout (so `docker logs` diagnostics keep
  working) and the file, as identical newline-delimited JSON, via an append-only synchronous
  stream.
- Production logs at level `error` (50) and above, which includes the custom levels
  `metric` (52) and `rateLimit` (55). An empty file on a healthy instance is normal.

### Container wiring

`deploy/azure/docker-compose.yml` sets the variable and bind-mounts the host directory over
the image's `/app/logs`:

```yaml
environment:
  TOMORI_LOG_FILE: /app/logs/tomoribot.jsonl
volumes:
  - /var/log/tomoribot:/app/logs
```

The container runs as the non-root user `tomori` (UID/GID 1001), so the host directory must
be owned by that ID. The Azure deploy workflow creates it before Compose starts:

```sh
sudo install -d -o 1001 -g 1001 -m 0750 /var/log/tomoribot
```

### Verifying the host file

After a deploy, on the VM:

```sh
sudo ls -la /var/log/tomoribot
sudo tail -n 3 /var/log/tomoribot/tomoribot.jsonl
```

Every nonempty line must be one valid JSON object. The file may legitimately be empty until
the first production error occurs.

## Step 2: Create the custom table

Create a custom table (this guide uses `TomoriBotLogs_CL`; the `_CL` suffix is required) in
your Log Analytics workspace with the Log Analytics Tables REST API
(`2021-12-01-preview`), using this schema:

| Column | Type | Purpose |
|---|---|---|
| `TimeGenerated` | DateTime | Original Pino event time, with ingestion time as fallback |
| `Computer` | String | Populated by Azure Monitor Agent |
| `FilePath` | String | Populated by Azure Monitor Agent |
| `level` | Int | Pino numeric level |
| `msg` | String | Pino log message |
| `code` | String | Top-level or nested error code |
| `type` | String | Error type/name |
| `commandName` | String | Command context when available |
| `message` | String | Error message with `msg` fallback |
| `RawData` | String | Original JSON line for detailed Grafana logs |

Wait until the table appears in the workspace before creating the DCR.

## Step 3: Create and associate the DCR

In Azure Portal, Monitor -> Data Collection Rules -> Create (platform **Linux**), associate
the rule with the VM (installing Azure Monitor Agent if prompted), and add a
**Custom Text Logs** data source:

- File pattern: `/var/log/tomoribot/tomoribot.jsonl`
- Table: `TomoriBotLogs_CL`
- Record delimiter: end-of-line (correct for JSONL)
- Destination: Azure Monitor Logs -> your workspace

Apply this ingestion-time transformation. Its projected columns must exactly match the table
schema. The trailing `where` clauses drop known-noisy records (periodic cache metrics and
provider availability retries) to control ingestion cost:

```kusto
source
| extend p = parse_json(RawData)
| extend EventTime = unixtime_milliseconds_todatetime(tolong(p.time))
| extend TimeGenerated = iff(isnull(EventTime), TimeGenerated, EventTime)
| extend level = toint(p.level)
| extend msg = tostring(p.msg)
| extend code = coalesce(tostring(p.code), tostring(p.err.code))
| extend type = coalesce(tostring(p.type), tostring(p.err.name))
| extend message = coalesce(tostring(p.message), tostring(p.err.message), tostring(p.msg))
| extend commandName = coalesce(tostring(p.commandName), tostring(p.context.commandName))
| where level >= 50
| where msg != "metric:cache_sizes"
| where RawData !contains "UNAVAILABLE"
| where RawData !contains "RESOURCE_EXHAUSTED"
| project TimeGenerated, Computer, FilePath, level, msg, code, type, message, commandName, RawData
```

## Step 4: Test ingestion end to end

Append a harmless synthetic level-50 record to the host file (do not manufacture a real bot
failure), wait roughly 5-10 minutes for initial ingestion, then query the workspace:

```kusto
TomoriBotLogs_CL
| where TimeGenerated > ago(30m)
| order by TimeGenerated desc
```

If nothing arrives, check: DCR-to-VM association, Azure Monitor Agent status on the VM, exact
file path and directory permissions, that each line is valid one-line UTF-8 JSON, DCR error
metrics, and that the transform's projected columns match the table schema exactly.

## Grafana

Point error panels at an Azure Monitor data source whose identity has `Reader` on the
resource group and `Log Analytics Reader` on the workspace. That identity needs **read access
only** — ingestion permissions belong to the DCR/agent path, never to Grafana. Use a
`Time series` panel for error counts over `level`/`TimeGenerated` and a `Logs` panel showing
`TimeGenerated`, `code`/`type`, `message`, `commandName`, and `RawData`.

## Operational rules

- **Keep the file append-only.** Do not add log rotation that renames files into a pattern
  the DCR's file glob still matches — Azure Monitor Agent treats a renamed file as new
  content and duplicates ingestion. Design retention so rotated files fall outside the
  collected pattern, and only after the pipeline is verified.
- **Cost control lives in the DCR transform.** Prefer adding `where` clauses there over
  widening what the bot writes; everything that passes the transform is billed ingestion.
- **stdout is unaffected.** `docker logs` keeps working regardless of `TOMORI_LOG_FILE`, so
  the file can be wiped or the variable removed without losing container diagnostics.
