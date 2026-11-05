---
title: "Hetzner migration"
sidebar:
  label: "Migration"
  hidden: true
---

`deploy/hetzner/` prepares an 8 GB amd64 host with four vCPUs. A single bot process owns four
gateway shards. PostgreSQL 16 accepts Unix-socket connections only. SearXNG and the bot share
an outbound network; Caddy exposes the OAuth and Patreon routes over HTTPS.

These files need staging and data rehearsals before production use. Start preparation while
Azure serves users. Choose the cutover window after every check below passes.

## Resource budget

| Service | Memory limit | Additional swap allowance |
|---|---|---|
| Bot | 3072 MiB | 1024 MiB |
| PostgreSQL | 2048 MiB | None |
| SearXNG | 512 MiB | None |
| Caddy | 256 MiB | None |

The remaining host memory covers the kernel, Docker, backup work, and transient allocations.
The host has 1 GiB of zram and no disk swap. PostgreSQL uses 512 MiB shared buffers, 4 MiB
`work_mem`, 128 MiB maintenance memory, and 64 MiB per autovacuum worker. Query memory can
multiply across plan nodes and connections, so verify peaks during a restore and backup.

Retain the existing daily recycle threshold of 1200 MiB while collecting the new host's memory
history. The installer reads the watchdog and recycle scripts from `terraform/azure/cloud-init.yaml`,
which the existing watchdog checks exercise. It installs the watchdog in observe-only mode and
leaves both timers disabled. Do not replace the extraction with a second copy of those scripts.

## Account and host preparation

Create the account and complete verification before ordering resources. [Cloud servers accrue
charges while stopped; deleting a rehearsal server stops its server charges. Retained IPs,
snapshots, and storage have separate charges](https://docs.hetzner.com/cloud/billing/faq/).
Confirm the live price and availability in the console before ordering. CX33 has the target resources; CPX32 is another amd64 option.

1. Choose Ubuntu 24.04 and fill in the operator SSH key and `OPERATOR_CIDRS` in a private copy of
   `deploy/hetzner/cloud-init.yaml`. Create a Cloud Firewall that permits TCP 22 from those CIDRs,
   TCP 80 and 443 publicly for HTTPS, and ICMP. Attach the firewall during server creation.
2. Provision with that cloud-init file. Enable delete and rebuild protection. Enable server-image
   backups for the production host. Preserve the smaller disk when upgrading CPU and RAM if you
   want to retain the option of downgrading later.
3. Run `sudo cloud-init status --wait`, inspect its output, and confirm SSH works in a second
   session before closing the first. Check `sudo ufw status verbose`, `swapon --show`, and
   `sudo sshd -T`. Password and root login must be disabled; only operator CIDRs may reach SSH.
4. Transfer `deploy/hetzner/` and `terraform/azure/cloud-init.yaml` from the same reviewed `release`
   checkout, preserving their directory layout. Run `sudo bash deploy/hetzner/install-host.sh`.

The installer writes files under `/etc/tomoribot` and installs backup and alert units. It does
not start the bot, reverse proxy, or timers. Database credentials remain outside Git.

## Initialize the empty host

Copy `.env.example` to `/etc/tomoribot/.env` with mode 0600. Set the two image references to
immutable digests from the running Azure containers, generate `SEARXNG_SECRET` with
`openssl rand -hex 32`, and set `TOMORI_PUBLIC_HOST` to the callback hostname. Use the existing
public hostname at production cutover so registered OAuth redirects remain valid.

Authenticate to the image registry for the pull, then log out. As root:

```bash
cd /etc/tomoribot
bash bootstrap.sh
docker compose pull tomoribot caddy
bash verify-host.sh
```

`bootstrap.sh` refuses existing credentials or database data. It generates a superuser password,
the schema owner's `admin-secrets.json`, runtime `secrets.db.json`, and the backup role's pgpass
file. It starts only PostgreSQL and SearXNG. Migration containers use the owner identity;
the bot receives only the DML identity. PostgreSQL's superuser uses peer authentication.

Install the dedicated Vertex service-account key through
`sudo /usr/local/sbin/tomoribot-install-vertex-key`, supplying JSON on stdin over SSH. The host
must have only Vertex AI User and Service Usage Consumer access for that identity, plus any
existing avatar-bucket access. Verify key-creation policy first. If keys are prohibited, stop
and design workload federation before continuing. Keep the Azure identity available for rollback.

Verify the key using `@google/genai` in a one-shot copy of the deployed image with the read-only
key mount. Its `models.list` request must succeed. Rotate keys from the operator workstation;
recreate the bot after replacing a single-file bind mount, then disable the previous key only
after a successful Vertex chat.

## Staging rehearsal

Use a separate Discord application in a test guild and the empty database. Build a staging
runtime bundle containing the staging Discord token, local runtime database fields, and the
required encryption/provider keys. Exclude production billing, Top.gg, Matrix, and other
outbound integrations. Never start a bot against restored production data during rehearsal:
stored reminders and persona webhooks can reach real channels even with a staging bot token.

Install that bundle as `/etc/tomoribot/secrets.json`, root:1001, mode 0640. Keep its public
base URL consistent with the staging hostname. Then:

```bash
cd /etc/tomoribot
bash migrate.sh
docker compose --profile gateway up -d tomoribot
curl -fsS http://127.0.0.1:8081/healthz
```

Verify all four shards, a slash command, a Vertex chat, SearXNG search, a persona webhook,
and local file storage. Stop and remove the staging bot before restoring production data.

`migrate.sh` refuses a running gateway or active watchdog/recycle timer. It uses the existing
`src/db/initializeCli.ts` entry point and includes `--supporter-billing` when the runtime bundle
enables billing. Run it before each image deployment, then apply the runtime grants it installs.

## HTTPS callbacks

Point a staging hostname at the new host before testing Caddy. Publish an A record; add an AAAA
record only after IPv6 listeners and firewall rules are configured and tested. Start Caddy with:

```bash
docker compose --profile gateway up -d caddy
```

`Caddyfile` forwards GET `/oauth/callback`, `/oauth/mcp/start`, and `/oauth/client.json`, plus
POST `/oauth/mcp/confirm` and `/supporter-billing/patreon/webhook`. Other requests return 404,
including public health probes. Caddy access logging is disabled so OAuth query parameters
stay out of access logs. The watchdog still reaches health on host loopback.

Before cutover, test Patreon linking and webhook signature validation with test credentials,
and test MCP sign-in. Preserve the production callback hostname and verify that the effective
`TOMORI_PUBLIC_BASE_URL` in the transferred bundle agrees with it. Reduce DNS TTL in advance;
account for cached DNS during the maintenance window and rollback. Do not run production
billing on both hosts during this check.

## Off-site backups

Use a Storage Box in a different region from the VM. Enable SSH support, a restricted backup
sub-account, and automatic Storage Box snapshots. Confirm the current product supports those
features before purchase. Keep its account credentials off the VM; install only the sub-account
SSH key and a verified server host key under `/etc/tomoribot/backup/`.

Create a passphrase-protected GPG encryption key on the trusted workstation. Keep two protected
copies of the private key and encryption-key history outside the VM. Import only its public key
into `/var/lib/tomoribot-backup/gnupg`, whose directory mode must be 0700. Create root-only
`/etc/tomoribot/backup/backup.env`:

```bash
STORAGEBOX_HOST=u123456-sub1.your-storagebox.de
STORAGEBOX_USER=u123456-sub1
GPG_RECIPIENT=REPLACE_WITH_THE_FULL_PUBLIC_KEY_FINGERPRINT
```

The backup directory also needs `storagebox_ed25519` and `storagebox_known_hosts`; the bootstrap
already created `pgpass`. Store an operator-channel webhook URL in the root-only curl config
`/etc/tomoribot/alert-webhook.curl`. Do not put credentials in shell arguments or command history.

At minute 30 of each UTC hour, the backup unit audits encrypted credentials, dumps PostgreSQL,
and encrypts the database, local files, and runtime secret bundle together. It uploads an archive
and checksum, downloads the encrypted archive to compare bytes, then retains 24 hourly copies,
7 daily copies, and 4 weekly copies. Daily and weekly archives are taken at 03 UTC. Only two
encrypted archives remain locally. An audit or restore-drill failure preserves older remote
archives and fails the unit so its alert fires. Sunday at 03 UTC also restores a scratch database
and audits its credentials. The GPG private key never enters the VM.

Database dumps and live files are captured separately. A changed-file archive result also keeps
older backups and fails the unit. A quiesced file copy is required when exact agreement between
database references and files is needed, including the final migration copy.

The normal recovery window is approximately one hour plus dump/upload time; a failed or missed
backup extends it. Check timer success and off-site archive freshness during operations.
Server-image backups complement the logical archives; they do not prove a PostgreSQL restore.

Before enabling the timer, manually run `systemctl start tomoribot-backup.service`. On the trusted
workstation, download that encrypted archive and checksum, verify the checksum, decrypt it,
verify the manifest's file hashes, and restore to an isolated database. Check row counts,
migrations, local files, and `bun run audit-keys`. On a newly initialized host, combine the restored
`runtime-secrets.json` with the new host's `secrets.db.json`, giving the new database fields
precedence and preserving every encryption-key version. Then:

```bash
systemctl enable --now tomoribot-backup.timer
systemctl list-timers tomoribot-backup.timer
```

## Production data rehearsal

Use verified TLS and PostgreSQL 16 clients for the Azure dump. Temporarily admit only the
Hetzner IPv4 address through Azure PostgreSQL's firewall, and remove that rule when finished.
Keep PostgreSQL ports closed on the Hetzner host.

1. Stop the staging bot. Dump Azure with `pg_dump --format=custom --compress=6 --no-password
   --exclude-schema=cron` over `sslmode=verify-full` and a trusted CA bundle.
2. On Hetzner, recreate the target database as `tomoriadmin`, create `vector` and `pgcrypto` as
   superuser, and remove extension/comment entries from the dump's TOC. Restore as `tomoriadmin`
   with `--no-owner --no-acl --exit-on-error --single-transaction`.
3. Reapply `postgres/grants.sql`, run `vacuumdb --analyze-only --jobs 2`, compare migration names,
   and run `postgres/rowcounts.sql` on both sides. Live Azure can change during rehearsal, so
   investigate differences rather than requiring changing tables to match exactly.
4. Audit encrypted credentials with the production encryption keys and the local runtime DB
   credentials, in a one-shot container with no network. Keep the restored gateway stopped.
5. Time the dump, restore, statistics, and checks. Repeat with the final image near cutover.

Back up and verify the local files too. Transfer them over authenticated SSH with host-key
verification; Azure's supported command path is VM Run Command, since inbound SSH is disabled.
Transfer secrets directly between hosts over the same verified channel without logging them.
Combine the Azure application bundle with `secrets.db.json`, giving local DB fields precedence.
Preserve every `CRYPTO_SECRET` version. Do not run `bootstrap.sh` against the restored database.

## Cutover and rollback

Cutover requires observed single-process sharding on Azure, a passing staging rehearsal, two
data rehearsals, verified off-site recovery, working HTTPS callbacks, and an operator who can
disable the Azure deploy workflow. Recheck the memory budget with the final sharded image.

1. Freeze releases, disable `deploy-azure.yml`, and announce maintenance. Save the exact running
   image digest and effective settings. Confirm sufficient disk space for dumps and restore work.
2. Stop Azure's watchdog and recycle timers and services, then stop the bot with at least 40 seconds
   of grace. Fence `tomoribot_runtime` with `NOLOGIN` and terminate its existing database sessions.
3. Transfer the final secret bundle and local files, and take the final Azure dump. Keep the
   encryption-key history intact. Restore and verify as rehearsed; row counts and migration names
   must now match exactly because Azure writers are stopped and fenced.
4. Install local files with UID/GID 1001, run `migrate.sh` using the same image digest, and verify
   the restored credentials. Switch the production hostname to the new ingress. Start only the
   Hetzner bot and Caddy with `docker compose --profile gateway up -d tomoribot caddy`.
5. Verify health for four shards, slash commands, Vertex, saved provider keys, SearXNG, persona
   webhooks, local assets, Patreon linking/webhooks, MCP sign-in, and backup completion. Check
   application errors, memory pressure, and restarts during the observation window.
6. Enable backup and recycle timers after checks pass. Enable the progress watchdog in observe-only
   mode; arm it after reviewing healthy operation across representative traffic. Keep Azure fenced
   and its deploy workflow disabled throughout the agreed rollback window.

Roll back before starting the new bot if restore, exact data checks, or credential audits fail.
Roll back if gateway readiness does not recover within 15 minutes or a provider, database, or
billing failure cannot be resolved within the maintenance window. Repeated OOMs or restarts
also fail the cutover.

To roll back, stop Hetzner's timers, services, bot, and Caddy before restoring DNS to Azure.
Archive Hetzner data first if it accepted writes. Unfence Azure's runtime role, start the Azure
bot and timers, verify health and callbacks, and re-enable its deployment workflow. Writes
accepted only on Hetzner require reconciliation before resuming Azure to avoid losing user or
billing changes. Define that reconciliation or explicitly accept the loss before rollback.

After the rollback window, verify a final encrypted Azure archive before retiring Azure resources,
its federation identity, or deployment credentials. Remove temporary migration firewall rules and
transfer keys. Update the production-inspection pointer in `AGENTS.md` only when Hetzner is live.
