---
title: Local Grafana Monitoring
sidebar:
  order: 6
aiGenerated: true
---

Monitor your local TomoriBot instance with prebuilt Grafana dashboards to track memory usage, cache sizes, token consumption, and command traffic.

Add a Grafana password to `.env`. Compose refuses to start the monitoring overlay without one, because Grafana's database connection has full access to your data:

```sh
GRAFANA_PASSWORD=choose-a-long-random-password
```

Start TomoriBot and Grafana together:

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

This starts TomoriBot, PostgreSQL, and Grafana with the TomoriBot Overview dashboard.

Open Grafana at [http://localhost:3000](http://localhost:3000):
- **Username**: `admin`
- **Password**: the `GRAFANA_PASSWORD` value from `.env`

Grafana accepts connections only from the computer running Docker. To open it from another computer, forward the port over SSH with `ssh -L 3000:localhost:3000 <user>@<host>`, then browse to `http://localhost:3000` on your own computer.

If you started Grafana before it required a password, it kept the password it first stored. Sign in with that password (`admin` if you never set one), then change it under your Grafana profile.

## The provisioned dashboard

The TomoriBot Overview dashboard loads automatically without manual configuration. Its panels display process memory, cache entry counts, errors per hour, token usage by model, hourly activity, top commands, user locales, an emotion cloud, and active presets and models.

Certain panels require specific runtime settings or host support:

| Panel | Needs |
|---|---|
| Process Memory, Cache Entries | `metric_samples` rows written every `CACHE_METRICS_INTERVAL_MS`. The collector runs only when `RUN_ENV=production`, so a development instance displays no data here. |
| Errors per Hour by Type | `ERROR_DB_LOGGING_ENABLED` (enabled by default). A flat line during an incident can indicate that the database circuit breaker is open rather than errors having ceased. |
| Host Memory and Swap Tiers, Host Pressure (PSI) and Swap-In Rate | A Linux host. These read `/proc/meminfo`, `/proc/pressure/*`, `/proc/swaps`, and `/sys/block/zram0`, so they remain empty on macOS and Windows. The zram series requires a configured zram swap device; hosts without zram still report general memory and pressure metrics. |

## Editing and keeping changes

Dashboards remain editable in the Grafana interface for live debugging. Because container restarts reset dashboard edits back to disk files, export your modified dashboard JSON and save it into `docker/grafana/dashboards/` to keep your changes.

To add a dashboard, place its JSON in `docker/grafana/dashboards/` and use the PostgreSQL datasource UID `tomoribot-postgres`.
