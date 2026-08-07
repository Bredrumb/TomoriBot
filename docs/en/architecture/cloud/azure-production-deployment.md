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

The GitHub deployment principal needs `Contributor` only on the deployment resource group and
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

### VM replacement protection and monitoring recovery

Terraform plans that delete or replace the production VM stop before apply. After reviewing the
saved plan, an operator may approve the replacement only through a manual dispatch with
`allow_vm_replacement=true`; release-branch pushes cannot bypass this guard.

The VM carries `lifecycle { ignore_changes = [custom_data] }` so that editing `cloud-init.yaml` is
not one of the ways a plan reaches that guard. Azure hands cloud-init to the guest agent once, at
provision time, which is why the provider treats `custom_data` as replace-only: rebuilding is the
sole way it can honour the diff. A host setting is therefore routinely applied to the running VM
first and backported to `cloud-init.yaml` afterwards, and without the exemption that backport would
plan a destructive replacement whose only effect is to reconstruct state the host already has.

The YAML stays authoritative for the next provision, so keep it accurate. Reaching that provision is
a deliberate act, though: removing the VM from state or destroying it, never a pushed YAML edit.
Verify a backport against the live host rather than trusting a clean plan, because Terraform no
longer reports drift on this field.

The Azure Monitor Linux Agent and both DCR associations are Terraform-managed children of the VM.
The DCR definitions, DCE, Log Analytics workspace, and custom tables remain externally managed and
are referenced through the non-sensitive DCR resource IDs in `terraform.ci.tfvars`. A normal
Terraform apply installs the agent and restores both associations on the current VM. A later
approved VM replacement destroys and recreates these attachments in the same dependency graph, so
guest-memory and cache telemetry recover without a separate portal operation. Update the committed
IDs only when an operator deliberately replaces a DCR.

To inventory the existing DCR IDs before the first adoption apply, authenticate Azure CLI and run:

```sh
az resource list \
  --resource-type Microsoft.Insights/dataCollectionRules \
  --query "[].{name:name,resourceGroup:resourceGroup,id:id}" \
  --output table
```

If the current VM already has an extension or association with the Terraform names, import that live
object instead of deleting it; a recreated VM normally has no such child objects, so the first apply
creates them.

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

#### Retrying queries killed by pool recycling

Bun's pool fires those recycling timers without draining first: it marks the connection failed and
rejects every queued and in-flight query on it, even when the query and the server are both healthy
([oven-sh/bun#30646](https://github.com/oven-sh/bun/issues/30646), open as of Bun 1.3.14). In
production this surfaced as `PostgresError: Max lifetime timeout reached after 10m`
(`ERR_POSTGRES_LIFETIME_TIMEOUT`) aborting a slash command and a guild emoji sync.

`withTransientDbRetry` in `src/utils/db/client.ts` re-issues those operations. It also covers the
stale prepared-statement plans it originally handled, but the two paths differ: a cached-plan error
calls `resetDatabaseConnection()` first, while a retired connection must not, because the pool has
already discarded the dead socket and a reset would throw away the rest of a healthy pool.
`POSTGRES_TRANSIENT_RETRY_ATTEMPTS` (default 2 total attempts) and
`POSTGRES_TRANSIENT_RETRY_DELAY_MS` (default 100) tune it.

One retirement reaches the application under several codes, so the classifier matches a set rather
than a single value. Alongside `ERR_POSTGRES_LIFETIME_TIMEOUT`, `ERR_POSTGRES_IDLE_TIMEOUT`, and
`ERR_POSTGRES_CONNECTION_CLOSED`, a connection that dies part-way through a wire message surfaces as
`ERR_POSTGRES_INVALID_MESSAGE` or `ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE`: Bun rejects the pending
queries from `#onClose` carrying whatever state its protocol reader stopped in, so the code describes
where the byte stream was truncated rather than any fault in the data. Production logged 82 of these
across unrelated servers in two bursts on 2026-08-06, every stack ending at `#onClose` and none
retried, because the last two codes were missing from the set. When triaging a new Postgres code,
read the stack before the code: a frame in `#onClose` means retirement regardless of the label.

The helper replays `queryFn`, so only reads, idempotent writes, and transactions may use it. A
transaction is safe because a socket that dies mid-transaction makes the server roll back; the
emoji and sticker reconciles qualify additionally because they are upsert-only. A non-idempotent
write must not use it: if the socket dies between `COMMIT` being sent and its acknowledgement
arriving, the replay double-applies.

### Read-only production data inspection

Host lockdown removes every inbound NSG allow rule, so `ssh` cannot reach the VM and the PostgreSQL
firewall does not admit an operator workstation. Ad-hoc production queries therefore run **inside the
bot container, driven through VM Run Command**, reading credentials from the mounted JSON secret file
rather than the container environment. This is the supported path for incident triage; do not reopen
SSH or widen the database firewall for it, and keep triage read-only.

The step-by-step recipe is an operator runbook against this specific deployment, so it lives in
[Azure Production Data Inspection](/wiki/azure-production-inspection/).

## Container and host operations

The Compose service runs as `1001:1001` with a read-only root filesystem, all Linux capabilities
dropped, `no-new-privileges`, PID/memory limits, explicit writable bind mounts, and size-limited
`tmpfs` mounts. The health port is bound only to `127.0.0.1`. Optional SearXNG is profile-gated,
unpublished, and digest-pinned.

### Enabling the SearXNG sidecar

Setting the `SEARXNG_SECRET` repository secret is the entire switch. The deploy passes it to
`run-command-deploy.sh`, which on a non-empty value adds `searxng` to the services named on
`docker compose up` (naming a profile-gated service activates its profile) and sets
`SEARXNG_BASE_URL=http://searxng:8080/` for the bot. Leaving the secret unset keeps the sidecar off
and the bot on its `Brave → DDG → Felo` chain.

One value drives both because the alternatives are failure modes: SearXNG will not start without a
secret, so a profile enabled separately would crash-loop, and a secret set without the profile would
do nothing. The deploy rejects a secret shorter than 32 characters. `SEARXNG_UWSGI_WORKERS` defaults
to `1` rather than uWSGI's one-per-CPU, since this VM is memory-constrained rather than CPU-bound.

The secret does **not** belong in `TOMORI_SECRETS_JSON`. That bundle is the application's runtime
secrets, forwarded field by field to `process.env` by `src/init/secrets.ts`, which does not forward
this key: the bot never reads it. It is a Compose-level value for a sidecar, so it is a separate
secret, and keeping it separate also avoids a read-modify-write on a bundle GitHub cannot read back.

This is a singleton: automatic platform patching or an operator reboot causes a short, expected bot
outage while the VM and `restart: unless-stopped` container return. Schedule disruptive maintenance
when a brief Discord disconnect is acceptable, then verify `/healthz`, Discord connectivity,
public-FQDN database access over verified TLS, and Vertex WIF after the reboot.

Docker uses `json-file` rotation with three 10 MiB files, live restore, and daemon-level
`no-new-privileges`. Application error JSONL remains on `/var/log/tomoribot`; Azure Monitor retains
ingested records for 30 days. Backup and application-data mounts remain under
`/var/lib/tomoribot` and require explicit operator retention decisions.

Each deploy pulls a new image digest and leaves the previous one untagged, so
`run-command-deploy.sh` runs `docker image prune -f` after the health check and file-permission
assertions pass. Pruning after the health check keeps the prior image available for rollback, and it
is dangling-only so tagged images and anything a running container references survive. The step is
never fatal: the deploy has already succeeded by that point, and reclaiming disk must not fail it.

### Memory limits must track physical RAM

`TOMORIBOT_MEMORY_LIMIT_MB` (default 512) sets both the Compose `mem_limit` and the
`CONTAINER_MEMORY_LIMIT_MB` the application reads. **These two must stay equal.** The application
sheds media load at 75% of that value and enters emergency cache clearing at 85%; if the cgroup
ceiling were lower than what the app believes it has, the container would be OOM-killed before it
ever shed load.

The value is sized against the `Standard_B2ats_v2`'s roughly 842 MB of usable RAM, not rounded up to
a convenient number. A limit above physical memory is unreachable: RSS cannot climb to it, the guard
never fires, and the kernel silently swaps the heap instead.

Two related traps:

- `src/init/secrets.ts` also reads `CONTAINER_MEMORY_LIMIT_MB` from the mounted secret bundle, but
  only when the environment does not already define it. Compose therefore wins on Azure, while
  AWS/GCP deployments that set no environment variable still fall back to the bundle. A stale copy
  of this key in the secret bundle is inert but misleading, so prefer removing it there.
- The guard measures `process.memoryUsage().rss`, which counts only resident pages. On a host with
  swap enabled the kernel suppresses RSS precisely when memory pressure is worst, so RSS alone can
  understate commitment. Confirm real state with per-process `VmSwap` from `/proc/*/status` rather
  than trusting RSS. See [Azure Production Data Inspection](/wiki/azure-production-inspection/)
  for the Run Command pattern.

`SEARXNG_MEMORY_LIMIT_MB` (default 256) is sized so the optional sidecar and the bot together stay
inside physical RAM. Enable the sidecar only after confirming the host has real headroom; the
`web_search` chain degrades to `Brave -> DuckDuckGo -> IAsk` without it.

### Compressed swap needs an OOM safety net

zram makes an oversubscribed host survivable, but it changes the failure mode in a way that needs a
deliberate counterweight. Without swap, a container that outgrows `mem_limit` is OOM-killed by its
cgroup and Docker's `unless-stopped` policy restarts it inside a minute. With zram the kernel always
has somewhere to put another page, so reclaim keeps succeeding and the OOM killer never fires. The
host settles into a thrashing equilibrium instead: available memory flat, CPU near idle, disk queue
depth an order of magnitude above baseline, and every process blocked on major faults. A bot in this
state stays Online, because the gateway socket survives at the OS level while nothing in the runtime
advances.

The distinguishing signature is a read-only disk storm. Reads climb while writes *fall*, because the
kernel is evicting clean file-backed pages (the Bun binary's own text, which needs no write to
discard) and faulting them straight back in. Anonymous pages would appear as swap writes instead, so
falling writes are what separate this from ordinary swapping.

`earlyoom` restores the fast, self-healing kill. `terraform/azure/cloud-init.yaml` installs it with a
drop-in that pins absolute thresholds and a victim policy:

- Absolute (`-M`) rather than percentage thresholds, so they read in the same units as an "Available
  Memory Bytes" alert. Size the SIGTERM threshold between the observed healthy floor and the plateau
  memory settles at during a stall, which means measuring both before choosing a number.
- `-s 100,100` is load-bearing. earlyoom fires only when the memory **and** swap conditions both
  hold, and a disk-backed overflow swapfile sitting at 0 used still counts toward `SwapTotal`,
  pinning swap-free percentage high permanently. At any lower value the daemon prints healthy-looking
  thresholds at startup and then never fires.
- `--avoid` must cover the container runtime and the cloud agent. On a locked-down host the agent is
  the only remaining access path, so killing it to reclaim memory is unrecoverable.

Verify victim selection without killing anything by running a second instance in dry run, with a
threshold above current availability so it triggers immediately:

```bash
timeout 6 earlyoom -M <above-current-avail-KiB> -s 100,100 --dryrun -r 0 \
  --prefer '^bun$' --avoid '^(systemd|dockerd|containerd|python3|node|sshd)$'
```

It names the process it would signal, then exits without acting.

Two kernel knobs pair with this. `vm.watermark_scale_factor` at its default of 10 leaves kswapd well
under 1 MiB of runway on a host this size, so allocations enter synchronous direct reclaim instead of
letting kswapd work ahead; `allocstall_*` in `/proc/vmstat` counts how often that happens. And
`vm.swappiness` must stay high: with zram measuring near 4:1, pages migrated back out of compressed
swap expand at that ratio, so lowering it to "preserve swap headroom" costs more RAM than it frees.

## Release proof and rollback

A production hardening rollout is proven only after the protected `validate` check passes, the PR
is merged without bypass, and the environment-scoped workflow succeeds through OIDC and Run
Command. Smoke-test `/healthz`, Discord connectivity, public-FQDN PostgreSQL/TLS, Vertex WIF, URL-fetch
IMDS blocking, `/stats generate`, and one representative slash command.

Application rollback means redeploying a previously reviewed immutable image digest with the same
runtime configuration. Do not restore an administrator credential to the runtime file. Database or
Terraform-state recovery follows its own runbook; see
[Azure Terraform State Recovery](/wiki/azure-terraform-state-recovery/).
