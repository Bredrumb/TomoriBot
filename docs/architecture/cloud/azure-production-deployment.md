---
title: "Azure Production Deployment"
sidebar:
  label: "Production Deployment"
  order: 1
---

TomoriBot's production deployment is a singleton Azure VM managed by Terraform. GitHub Actions
authenticates to Azure with an environment-scoped OpenID Connect (OIDC) token and deploys through
Azure VM Run Command. The VM exposes no public inbound service; its static public IP exists only as
a low-cost outbound SNAT path.

## Trust boundary

The protected `production` GitHub environment accepts only the `release` branch. The Azure
workflow has `contents: read` by default, grants `id-token: write` only to
`deploy-with-terraform`, and grants `contents: write` only to the release-creation job. The Azure
federated credential subject must be exactly:

```text
repo:Bredrumb/TomoriBot:environment:production
```

The GitHub deployment principal needs `Contributor` only on `tomoribot-rg` and
`Storage Blob Data Contributor` only on the `tfstate` container. It must not retain subscription
`Contributor`, `Owner`, `User Access Administrator`, or unrelated resource-group roles after the
replacement workflow is proven.

Store these Azure-only values in the `production` environment, not as repository secrets:

- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`
- `AZURE_POSTGRES_ADMIN_PASSWORD`
- `AZURE_VM_SSH_PUBLIC_KEY` (a provisioning-only public key; CI has no private key)
- `TOMORI_SECRETS_JSON`
- `GRAFANA_EGRESS_IP` as an environment variable

If the first cutover finds that the existing `TOMORI_SECRETS_JSON` still contains the PostgreSQL
administrator login, create a temporary `AZURE_POSTGRES_RUNTIME_PASSWORD` environment secret with
a new random value of at least 32 characters. The payload step overlays only `POSTGRES_USER` and
`POSTGRES_PASSWORD`, persists the complete corrected JSON back to `TOMORI_SECRETS_JSON`, and uses
that same bundle for bootstrap and deployment. Delete `AZURE_POSTGRES_RUNTIME_PASSWORD` after the
successful cutover. This recovery path preserves every unrelated application credential without
making the write-only GitHub secret visible. A preflight checks the source bundle and migration
credential before Terraform planning or apply, so configuration errors cannot mutate Azure first.

The first merge to `release` starts the deployment workflow immediately, before a manual dispatch
can use the newly merged workflow. For that one cutover only, set the `production` environment
variable `RUN_DATABASE_BOOTSTRAP=true` before merging. The merge-triggered job then performs the
idempotent database bootstrap before installing the non-administrator runtime bundle. Delete the
variable immediately after that run succeeds so ordinary release pushes cannot bootstrap schema or
roles. Do not use this flag for recurring deployments.

Docker Hub and release-notification credentials may remain repository-scoped because the retained
AWS/GCP workflows also use them. Delete `PAT_TOKEN` and `AZURE_VM_SSH_PRIVATE_KEY` only after the
environment-scoped Run Command deployment succeeds.

## Deployment lifecycle

The workflow deliberately separates recurring releases from one-time lifecycle operations.

### Database bootstrap

For the first non-administrator cutover, set the one-time environment flag described above before
merging. Later operator-requested reruns can be manually dispatched from `release` with
`run_database_bootstrap=true`. The idempotent
[`bootstrap-database.sh`](../../../deploy/azure/bootstrap-database.sh) operation:

1. creates or updates `tomoribot_runtime` as `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`,
   `NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS`;
2. runs schema initialization and migrations once with the administrator bundle;
3. grants only database `CONNECT`, schema `USAGE`, table DML, sequence access, and function
   execution, plus matching default privileges; and
4. verifies the runtime role cannot create databases or objects in `public`.

The administrator bundle contains only PostgreSQL connection fields, is staged for the one-shot
container, and is deleted when Run Command exits. It is never installed as `/etc/tomoribot/secrets.json`.

### Recurring deployment

Every deploy runs [`run-command-deploy.sh`](../../../deploy/azure/run-command-deploy.sh), which has
only these responsibilities:

- validate and atomically install the runtime JSON, Vertex WIF configuration, and Compose file;
- reject administrator runtime users and non-digest image references;
- authenticate to Docker Hub only long enough to pull the immutable image digests, then log out;
- start the TomoriBot Compose service without an implicit pull; and
- verify UID/GID `1001:1001`, private PostgreSQL DNS, root-owned configuration modes, and
  `http://localhost:8081/healthz`.

The runtime container sets `DATABASE_SCHEMA_MANAGEMENT_ENABLED=false`, so startup verifies database
connectivity but cannot execute migrations or `pg_cron` administration.

### Host lockdown

After a successful deployment, manually dispatch once with `run_host_lockdown=true`. The idempotent
[`host-lockdown.sh`](../../../deploy/azure/host-lockdown.sh) operation installs an SSH hardening
drop-in, removes the provisioning user from the `docker` group, enables UFW with deny-by-default
inbound policy, and disables guest SSH. The workflow then fails unless the Azure NSG contains zero
inbound allow rules. Continue using VM Run Command for administration and health checks.

## Database and Grafana boundary

The application resolves the Azure PostgreSQL hostname through the linked private DNS zone and
connects through the private endpoint with certificate and hostname verification. Public database
access exists only for the Terraform-managed `GRAFANA_EGRESS_IP` exact address.

Grafana must use its dedicated `grafana` login, never `tomoribot_runtime` or the PostgreSQL
administrator. Configure the PostgreSQL datasource with TLS mode `verify-full`, the Azure server
hostname (not an IP address), and the operating-system CA trust store. The login is whole-database
read-only: `CONNECT`, schema `USAGE`, current/future table `SELECT`, and
`default_transaction_read_only=on`.

Before declaring the datasource cutover complete, inspect the saved datasource configuration and
run a read query such as the daily `stat_counters` aggregation. Confirm a write fails and that a
connection from outside `GRAFANA_EGRESS_IP/32` is rejected before password authentication.

## Container and host operations

The Compose service runs as `1001:1001` with a read-only root filesystem, all Linux capabilities
dropped, `no-new-privileges`, PID/memory limits, explicit writable bind mounts, and size-limited
`tmpfs` mounts. The health port is bound only to `127.0.0.1`. Optional SearXNG is profile-gated,
unpublished, and digest-pinned.

This is a singleton: automatic platform patching or an operator reboot causes a short, expected bot
outage while the VM and `restart: unless-stopped` container return. Schedule disruptive maintenance
when a brief Discord disconnect is acceptable, then verify `/healthz`, Discord connectivity,
private database access, and Vertex WIF after the reboot.

Docker uses `json-file` rotation with three 10 MiB files, live restore, and daemon-level
`no-new-privileges`. Application error JSONL remains on `/var/log/tomoribot`; Azure Monitor retains
ingested records for 30 days. Backup and application-data mounts remain under
`/var/lib/tomoribot` and require explicit operator retention decisions.

## Release proof and rollback

A production hardening rollout is proven only after the protected `validate` check passes, the PR
is merged without bypass, and the environment-scoped workflow succeeds through OIDC and Run
Command. Smoke-test `/healthz`, Discord connectivity, private PostgreSQL/TLS, Vertex WIF, URL-fetch
IMDS blocking, `/stats generate`, and one representative slash command.

Application rollback means redeploying a previously reviewed immutable image digest with the same
runtime configuration. Do not restore an administrator credential to the runtime file. Database or
Terraform-state recovery follows its own runbook; see
[Azure Terraform State Recovery](./azure-terraform-state-recovery/).
