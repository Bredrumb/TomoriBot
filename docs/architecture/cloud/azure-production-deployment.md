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
2. runs schema initialization and migrations with the database-only administrator bundle only
   when the workflow detected that the PostgreSQL server did not exist before Terraform apply;
3. grants only database `CONNECT`, schema `USAGE`, table DML, sequence access, and function
   execution, plus matching default privileges; and
4. verifies the runtime role cannot create databases or objects in `public`.

The administrator bundle contains only PostgreSQL connection fields, is staged for the one-shot
container, and is deleted when Run Command exits. It is never installed as `/etc/tomoribot/secrets.json`.
For an existing PostgreSQL server, bootstrap skips all schema and seed operations and changes only
the runtime role and its privileges — schema and migrations are instead applied on every deploy by the
separate always-on step below. Schema-container failures are retained in the access-controlled
Azure Run Command record without exposing that output in the public Actions log.

### Schema and migration application

Because the runtime role has no DDL privilege, the running bot cannot apply schema changes
(`DATABASE_SCHEMA_MANAGEMENT_ENABLED=false`). To preserve the pre-hardening guarantee that idempotent
schema and migrations always apply on deploy, **every** deploy runs
[`migrate-database.sh`](../../../deploy/azure/migrate-database.sh) as a dedicated step before the bot
is (re)started. It:

1. runs the same `initializeCli` entrypoint the local boot path uses (idempotent `schema.sql` plus the
   tracked `NNN_*.sql` migration runner), in a one-shot container using the database-only administrator
   bundle — the only identity permitted to create tables or apply migrations in production;
2. touches no roles or grants: new tables inherit runtime and Grafana privileges automatically from the
   `ALTER DEFAULT PRIVILEGES` rules `bootstrap-database.sh` installs for the administrator role; and
3. fails the deploy (before the bot restarts) if migration does not report success.

Destructive migrations (`DROP`, `ALTER COLUMN ... TYPE`, `TRUNCATE`, unfiltered `DELETE`, etc.) are still
blocked upstream by the **Destructive migration gate** unless the deployer opts into a pre-deploy backup
(a `(Checkpoint)` commit message on push, or `create_db_backup=true` on manual dispatch). This is why the
gate matters: routine pushes now genuinely apply migrations, so an unguarded destructive change is caught
before it reaches the database.

### Recurring deployment

Every deploy runs [`run-command-deploy.sh`](../../../deploy/azure/run-command-deploy.sh), which has
only these responsibilities:

- validate and atomically install the runtime JSON, Vertex WIF configuration, and Compose file;
- reject administrator runtime users and non-digest image references;
- authenticate to Docker Hub only long enough to pull the immutable image digests, then log out;
- start the TomoriBot Compose service without an implicit pull; and
- verify UID/GID `1001:1001`, a database query over verified TLS to the public Azure PostgreSQL
  FQDN, root-owned configuration modes, and `http://localhost:8081/healthz`.

The runtime container sets `DATABASE_SCHEMA_MANAGEMENT_ENABLED=false`, so startup verifies database
connectivity but cannot execute migrations or `pg_cron` administration. Migrations are applied
out-of-band on every deploy by the privileged step in [Schema and migration application](#schema-and-migration-application),
which runs before this deploy step.

### Host lockdown

After a successful deployment, manually dispatch once with `run_host_lockdown=true`. The idempotent
[`host-lockdown.sh`](../../../deploy/azure/host-lockdown.sh) operation installs an SSH hardening
drop-in, removes the provisioning user from the `docker` group, enables UFW with deny-by-default
inbound policy, and disables guest SSH. The workflow then fails unless the Azure NSG contains zero
inbound allow rules. Continue using VM Run Command for administration and health checks.

## Database and Grafana boundary

PostgreSQL uses its public Azure FQDN, but its firewall permits only two exact source addresses: the
VM's Terraform-managed static public IP and `GRAFANA_EGRESS_IP`. The application and Grafana both
connect with TLS certificate and hostname verification. Do not add `0.0.0.0`, enable access from all
Azure services, or widen either firewall rule.

Grafana must use its dedicated `grafana` login, never `tomoribot_runtime` or the PostgreSQL
administrator. Configure the PostgreSQL datasource with TLS mode `verify-full`, the Azure server
hostname (not an IP address), and the operating-system CA trust store. The login is whole-database
read-only: `CONNECT`, schema `USAGE`, current/future table `SELECT`, and
`default_transaction_read_only=on`.

Before declaring the datasource cutover complete, inspect the saved datasource configuration and
run a read query such as the daily `stat_counters` aggregation. Confirm a write fails and that a
connection from outside `GRAFANA_EGRESS_IP/32` is rejected before password authentication.

### Connection-pool hygiene on the public endpoint

Because the application now reaches PostgreSQL over the public Azure gateway rather than a private
endpoint, the runtime client sets pool-recycling options (`src/utils/db/client.ts`). Azure's public
gateway silently reaps idle TCP connections after roughly four minutes without sending a RST; a
pooled connection reaped this way becomes a black hole, so the next query hangs until an application
timeout fires (~3 minutes). Chat turns exhibited this — but lightweight slash commands, which touch
the pool more opportunistically, largely did not. `POSTGRES_IDLE_TIMEOUT_SECONDS` (default 30)
recycles idle connections before the gateway can reap them, `POSTGRES_MAX_LIFETIME_SECONDS`
(default 600) caps total connection age, and `POSTGRES_CONNECTION_TIMEOUT_SECONDS` (default 10)
turns a dead-path hang into a fast, retryable failure. Defaults are production-safe; tune only during
an incident. This was fixed at the client layer deliberately, so the private endpoint stays removed
and the free-tier cost target holds.

## Container and host operations

The Compose service runs as `1001:1001` with a read-only root filesystem, all Linux capabilities
dropped, `no-new-privileges`, PID/memory limits, explicit writable bind mounts, and size-limited
`tmpfs` mounts. The health port is bound only to `127.0.0.1`. Optional SearXNG is profile-gated,
unpublished, and digest-pinned.

This is a singleton: automatic platform patching or an operator reboot causes a short, expected bot
outage while the VM and `restart: unless-stopped` container return. Schedule disruptive maintenance
when a brief Discord disconnect is acceptable, then verify `/healthz`, Discord connectivity,
public-FQDN database access over verified TLS, and Vertex WIF after the reboot.

Docker uses `json-file` rotation with three 10 MiB files, live restore, and daemon-level
`no-new-privileges`. Application error JSONL remains on `/var/log/tomoribot`; Azure Monitor retains
ingested records for 30 days. Backup and application-data mounts remain under
`/var/lib/tomoribot` and require explicit operator retention decisions.

## Release proof and rollback

A production hardening rollout is proven only after the protected `validate` check passes, the PR
is merged without bypass, and the environment-scoped workflow succeeds through OIDC and Run
Command. Smoke-test `/healthz`, Discord connectivity, public-FQDN PostgreSQL/TLS, Vertex WIF, URL-fetch
IMDS blocking, `/stats generate`, and one representative slash command.

Application rollback means redeploying a previously reviewed immutable image digest with the same
runtime configuration. Do not restore an administrator credential to the runtime file. Database or
Terraform-state recovery follows its own runbook; see
[Azure Terraform State Recovery](./azure-terraform-state-recovery/).
