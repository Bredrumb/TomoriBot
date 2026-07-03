---
title: Local Monitoring with Grafana
sidebar:
  order: 14
---
# Local Monitoring with Grafana

You can monitor your local TomoriBot instance with Grafana dashboards using a provided Docker Compose profile. 
*(If you are looking for production Google Cloud monitoring, see [local-grafana-setup.md](local-grafana-setup.md) instead).*

To start both TomoriBot and Grafana together on your machine:

```sh
docker compose -f docker-compose.yaml -f docker-compose.monitor.yaml up -d
```

This will:
- Launch TomoriBot with PostgreSQL (on port 15432 for DB)
- Launch Grafana on port 3000 with an auto-configured PostgreSQL datasource
- Connect both services on the same Docker network

Access Grafana at [http://localhost:3000](http://localhost:3000):
- **Username**: `admin`
- **Password**: Set via `GRAFANA_PASSWORD` in `.env` (defaults to `admin` if unset)

The PostgreSQL datasource is automatically configured and ready to create dashboards for monitoring bot metrics, database queries, and performance.