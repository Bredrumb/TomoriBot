# Azure Production Security Hardening Plan

> **Status (2026-07-20):** In progress. Simplified after the implementation review to focus on material attack paths for TomoriBot's low-cost singleton deployment.
>
> **Scope:** The Azure VM, PostgreSQL Flexible Server, Terraform state, GitHub Actions deployment path, and the Azure/Google workload-identity boundary.
>
> **Checkbox evidence:** `(live)` means verified in the deployed Azure/GitHub environment; `(working tree)` means implemented or verified only in the current unmerged checkout; `(decision)` records an intentional simplification that needs no implementation. Phase gates remain unchecked until their stated end-to-end proof is complete.
>
> **Handoff note:** This plan is explicitly unignored by `.gitignore` so its evidence and remaining live steps travel with the hardening change.
>
> **Cutover readiness (2026-07-20):** The implementation, documentation, local quality gates, and required PR validation are complete on PR #51. The remaining unchecked work requires the protected `release` path or live Azure changes: populate the `production` environment secrets, set the one-time `RUN_DATABASE_BOOTSTRAP=true` environment variable, merge, clear that variable after the successful bootstrap/deployment, run host lockdown, remove fallback credentials and roles, and collect the final runtime evidence. Do not merge, push to `release`, or start the Azure workflow without the operator's explicit go-ahead.

## Goal

Reach a practical production baseline without turning a small Discord bot into a large platform-engineering project:

- Reviewed code reaches production through a protected GitHub environment and short-lived OIDC authentication.
- Deployment and health checks do not require public SSH.
- TomoriBot uses PostgreSQL private connectivity and a non-administrator application login; the operator's local Grafana may use one explicit `/32` public firewall exception with a separate read-only login.
- The VM uses Trusted Launch and automatic security patching.
- The application container is non-root and has basic runtime restrictions.
- Logs redact credentials and Terraform state is access-controlled and recoverable.

## Explicit Simplifications

These decisions are part of the plan, not unfinished security work.

| Area | Simplified decision | Rationale |
|---|---|---|
| Production secrets | Do not inventory or rotate every Discord, R2, Matrix, webhook, and provider credential in this pass. Do not evaluate Key Vault or rescope R2 here. Keep only the non-admin database cutover and atomic root-owned file installation required by other phases. | Mass rotation and a new secret backend add outage risk and operational work without addressing the audited Azure entry points. Rotate a specific credential later when compromise, expiry, or provider policy warrants it. |
| Grafana and token charts | Keep Grafana's direct PostgreSQL datasource with a dedicated whole-database read-only role and one exact operator egress `/32`. Remove the custom Log Analytics token-metrics replacement. | Direct SQL supports token, cost, usage, and future exploratory charts naturally. A timer, custom table, and DCR flow duplicate authoritative PostgreSQL data. The accepted tradeoff is that this operator credential can read application data, so it must remain separate, read-only, TLS-protected, and IP-restricted. |
| Deployment script | Keep recurring deployment limited to atomic config installation, immutable image pull, Compose rollout, and a few meaningful checks. Move database-role bootstrap and host lockdown to separately run, idempotent one-time operations. | Combining identity creation, migrations, grants, firewall/SSH changes, deployment, and verification makes failures harder to diagnose and rollback. |
| Alerting | Use GitHub Actions run status for deployment failures, preserve the existing Discord release-success notification, and retain Azure Activity Log/diagnostic history. Do not create a new failure webhook or broad alert suite in this pass. | Alerts without an established response process create noise and maintenance. Add targeted alerts after observing real failure modes. |
| Defender and Advisor | Review recommendations once; record only material unresolved findings. Do not require resolving or formally accepting every recommendation. | Many recommendations are generic, paid-tier, or inapplicable to a low-cost singleton VM. |
| Recovery testing | Document PostgreSQL restore and Terraform state-version recovery. Do not make a disposable full restore or state rollback a release blocker. | Live recovery drills deserve a separate, scheduled exercise with an explicit cost and data-safety window. |
| Supply chain | Keep lockfiles, action SHAs, immutable deploy digests, and reviewed base-image digests. Defer new SBOM/provenance publishing. | Reproducible inputs deliver the immediate benefit; provenance infrastructure is a separate capability. |
| Smoke testing | Verify health, Discord connectivity, database access, Vertex WIF, URL-fetch SSRF protection, and one representative slash command. Do not gate on manually exercising every media, voice, Matrix, RAG, persona, and provider path. | Exhaustive manual testing is costly and unreliable; existing automated tests cover most application behavior. |
| Network proof | Test the configured production providers and required platform endpoints, not every integration TomoriBot can theoretically support. | Unconfigured integrations are not part of the live attack surface or availability path. |

## Non-Goals

- Changing the singleton VM architecture or introducing scale-to-zero hosting.
- Replacing Cloudflare R2 or Docker Hub.
- Migrating to Azure AI Foundry.
- Adopting Azure Key Vault in this pass.
- Rotating every application/provider credential.
- Building new observability products, dashboards, SBOM publication, or a comprehensive SOC alert suite.
- Running destructive recovery drills during the deployment hardening change.

## Required Ordering

1. Add and test replacement access before removing the old path.
2. Test the environment-scoped OIDC deployment before deleting the branch federated credential or subscription-wide role.
3. Test Azure Run Command deployment before closing SSH.
4. Verify private PostgreSQL DNS/TLS for the app before deleting the VM public firewall rule; preserve only the documented Grafana `/32` exception.
5. Cut the application to a non-admin database login before removing the administrator credential from the runtime file.

---

## Phase 0 — Containment and Inventory

### Repository and identity controls

- [x] Protect both `main` and `release` with pull requests, the `validate` status check, up-to-date branches, deletion protection, and non-fast-forward protection. `(live)`
- [x] Remove the permanent ruleset bypass. `(live)`
- [x] Require third-party GitHub Actions to use full commit SHAs. `(live)`
- [x] Create the `production` environment and restrict deployments to `release`. `(live)`
- [x] Add the Entra federated credential for `repo:Bredrumb/TomoriBot:environment:production` while retaining the old branch credential for rollback. `(live)`
- [x] Record that required reviewers cannot be enabled until a second trusted maintainer exists. `(live constraint)`
- [ ] After the reviewed workflow lands, verify an environment-gated OIDC login and that a non-production job cannot obtain the production token.

### Live network inventory

- [x] Inventory PostgreSQL firewall rules and identify the workstation address as the active local Grafana egress IP. `(live)`
- [x] Remove stale/broad rules and the VM public-IP rule; retain only the exact Grafana operator `/32`. `(live)`
- [x] Verify the bot remains healthy and the database hostname resolves privately from the VM. `(live)`

---

## Phase 1 — Simplified CI/CD Trust Path

### Workflow permissions and credentials

- [x] Set default GitHub token permission to `contents: read`. `(working tree)`
- [x] Grant `id-token: write` only to `deploy-with-terraform` and `contents: write` only to `create-release`. `(working tree)`
- [x] Replace release-job `PAT_TOKEN` use with `${{ github.token }}` in the Azure, AWS, and GCP workflows. `(working tree)`
- [x] Remove unnecessary Docker Hub logins from build/scan jobs. `(working tree)`
- [x] Add non-cancelling production deployment concurrency. `(working tree)`
- [x] Stop printing raw production container logs to public Actions output. `(working tree)`
- [ ] Move Azure-only deployment values and the runtime application JSON to the `production` environment. The environment currently contains only `GRAFANA_EGRESS_IP`; deployment secrets remain repository-scoped.
- [ ] After the replacement workflows are merged, delete the repository PAT and obsolete Azure SSH private-key secret.

### Azure authorization

- [x] Add `Contributor` on `tomoribot-rg` and retain `Storage Blob Data Contributor` on the `tfstate` container. `(live)`
- [x] Confirm the GitHub principal has no `Owner`, `User Access Administrator`, Key Vault administration, or unrelated resource-group role. `(live)`
- [x] Confirm the VM managed identity has no Azure subscription/resource roles; Google WIF does not require them. `(live)`
- [ ] Run the complete environment-scoped workflow once while subscription `Contributor` remains as rollback.
- [ ] Remove subscription-level `Contributor`, rerun the workflow, and keep only resource-group plus state-container access.
- [ ] Remove the old branch-subject federated credential after the environment-subject workflow succeeds.

### Simplify the recurring deployment path

- [x] Replace SSH/SCP and `ssh-keyscan` with Azure VM Run Command. `(working tree)`
- [x] Transfer secret/config payloads through root-owned unpredictable staging and install them atomically. `(working tree)`
- [x] Reduce `deploy/azure/run-command-deploy.sh` to recurring deployment responsibilities: `(working tree; ShellCheck passes)`
  - [x] validate/install runtime JSON, Vertex config, and Compose config;
  - [x] authenticate only long enough to pull immutable image digests, then logout;
  - [x] run Compose and verify UID `1001:1001`, private DB DNS, file modes, and `/healthz`.
- [x] Move database role creation/grants/migrations into an explicit, idempotent one-time bootstrap command. `(working tree; deploy/azure/bootstrap-database.sh)`
- [x] Move UFW enablement, SSH disablement, and docker-group removal into an explicit, idempotent host-lockdown command run only after deployment verification. `(working tree; deploy/azure/host-lockdown.sh)`

Rationale: recurring releases should not silently rotate database roles or mutate host access controls. Separating those lifecycle events makes rollout failures smaller and recovery clearer.

### Phase 1 gate

- [ ] A reviewed production deployment succeeds through OIDC and Run Command.
- [x] Only the Terraform job can request an Azure OIDC token. `(working tree: deploy-with-terraform is the Azure workflow's sole id-token: write job; actionlint passes)`
- [ ] Port 22 is removed from the NSG and the deploy user is not in the `docker` group.
- [ ] The old branch credential, subscription-wide role, PAT, and SSH private-key secret are removed.

---

## Phase 2 — PostgreSQL Baseline

### Private connectivity and TLS

- [x] Create the private-endpoint subnet, PostgreSQL private endpoint, private DNS zone, and VNet link. `(live)`
- [x] Import the live private networking resources into Terraform state. `(live)`
- [x] Verify the production VM resolves PostgreSQL to `10.80.2.4`. `(live)`
- [x] Use the operating-system trust store for Azure PostgreSQL while preserving hostname and certificate verification. `(working tree)`
- [x] Keep the AWS RDS CA only for AWS and add a provider-specific TLS regression test. `(working tree)`
- [x] Verify TLS 1.2 or newer through the private endpoint from the production VM; the observed connection negotiated TLS 1.3 with certificate and hostname verification. `(live)`

### Non-administrator runtime login

- [x] Add a runtime mode that verifies connectivity without executing migrations or `pg_cron` administration. `(working tree)`
- [x] Add a separate one-shot schema initialization entry point. `(working tree)`
- [x] In the one-time database bootstrap, create `tomoribot_runtime` without admin, database-creation, role-creation, replication, bypass-RLS, or extension privileges. `(working tree; live execution pending)`
- [x] Grant only database connect, schema usage, required table DML, sequence access, and function execution; configure matching default privileges. `(working tree; live execution pending)`
- [ ] Deploy the runtime JSON with `tomoribot_runtime` and prove normal startup plus one representative command.
- [ ] Confirm the running container cannot perform schema administration and does not contain the PostgreSQL administrator login.

Current live state: the running application still uses `tomoriadmin`; the runtime-role cutover has not occurred.

### Keep direct read-only Grafana queries

The current **token panel** is a local Grafana visualization of aggregate input/output token counts and estimated cost by day/model. It reads PostgreSQL `stat_counters` through the separate `grafana` login. Keeping direct SQL also permits new statistics and charts without creating duplicate telemetry pipelines.

- [x] Verify the separate `grafana` login has `CONNECT`, schema `USAGE`, and `SELECT` on all 84 current application tables. `(live)`
- [x] Verify matching default `SELECT` privileges exist for future tables created by the migration owner. `(live)`
- [x] Verify `default_transaction_read_only=on` and no schema creation, table mutation, role creation, database creation, replication, bypass-RLS, or superuser privileges. Default `PUBLIC` execution remains on 162 `public`-schema functions; none is `SECURITY DEFINER`, so revoking them is deferred as unnecessary complexity. `(live)`
- [x] Confirm Grafana does not use the application runtime or PostgreSQL administrator credential. `(live local Grafana metadata: Azure-PostgreSQL uses the separate grafana login)`
- [x] Confirm the Grafana PostgreSQL datasource performs TLS certificate and hostname verification. `(live local Grafana sslmode=verify-full; independent hostname verification negotiated TLS 1.3 with verify code 0)`
- [x] Restrict PostgreSQL ingress to the exact current Grafana egress `/32`. `(live)`
- [x] Represent the Grafana firewall exception explicitly in Terraform with an operator-supplied IPv4 value; do not restore broad or ad hoc rules. `(working tree and imported live state)`
- [x] Remove the locally added `tokenMetricsLogger` source/test/timer initialization. `(working tree)`
- [ ] Remove the stale `Custom-TomoriBotTokenMetrics_CL` output flow from the DCR. The source/test/timer and custom table are already removed; only the DCR flow remains.
- [x] Preserve the existing Azure Monitor VM, error-log, and cache panels alongside direct PostgreSQL statistics panels. `(live local Grafana dashboard metadata)`

Rationale: a narrowly authenticated read-only SQL datasource is simpler and more flexible than duplicating PostgreSQL aggregates into a custom Log Analytics pipeline. The read-only role can see application data, so its credential and `/32` network exception are treated as operator access, not public application access.

### Finish application-path privatization

- [ ] Verify application startup, schema bootstrap, backup tooling, and representative queries through the private endpoint.
- [x] Remove the VM public-IP firewall rule after proving the running app uses the private endpoint. `(live)`
- [x] Keep PostgreSQL public network access enabled only for the Terraform-managed Grafana `/32`. `(live)`
- [ ] Confirm a connection from outside the allowed Grafana `/32` is rejected before password authentication.
- [x] Add Terraform validation that accepts one explicit, non-zero Grafana IPv4 and manages only that one public firewall rule. `(working tree)`

### Phase 2 gate

- [ ] The app runs as `tomoribot_runtime`, not `tomoriadmin`.
- [x] The application uses the private endpoint; the only public PostgreSQL firewall rule is the explicit Grafana `/32`. `(live)`
- [x] Private DNS and verified TLS work from the VM. `(live)`
- [ ] Grafana's Azure Monitor and direct read-only PostgreSQL panels work without an administrator or application-runtime credential.

---

## Phase 3 — VM, Container, and IMDS Boundary

### Platform and host

- [x] Confirm the VM size/image support Trusted Launch. `(live)`
- [x] Enable Trusted Launch, Secure Boot, vTPM, automatic patch assessment, and automatic guest patching live and in Terraform. `(live and working tree)`
- [x] Verify the bot returned healthy after the required VM restart. `(live)`
- [ ] Run the separated host-lockdown command, then verify no public inbound NSG rule, password/root SSH login, or deploy-user docker membership remains.
- [ ] Keep the public IP only for low-cost outbound SNAT; expose no inbound service.
- [x] Document the singleton reboot/maintenance expectation and Docker/log retention defaults. `(working tree)`

### Container restrictions

- [x] Configure UID/GID `1001:1001`, `no-new-privileges`, capability drop, PID/memory limits, read-only root filesystem, and explicit writable mounts/tmpfs. `(working tree)`
- [x] Keep the health port loopback-only and optional SearXNG unpublished/digest-pinned. `(working tree)`
- [ ] Deploy the restrictions and verify health, Discord connectivity, database access, `/stats generate`, and one representative slash command.
- [x] Fail deployment on the meaningful UID and health invariants; do not depend on distro-specific group-name rendering. `(working tree)`

### SSRF and managed identity

- [x] Keep `FETCH_URL_ALLOW_PRIVATE_NETWORK=false` in production. `(working tree)`
- [x] Block loopback, private, link-local, reserved, and Azure IMDS addresses. `(working tree)`
- [x] Replace the bundled redirect-following fallback with an in-process fetcher that validates and DNS-pins every redirect hop and caps response bytes. `(working tree)`
- [x] Add regression coverage for direct IMDS targets and public-to-IMDS redirects. `(working tree)`
- [x] Preserve the exact Google WIF `xms_mirid` condition and confirm the VM identity has no unrelated Azure roles. `(live configuration and working tree)`
- [ ] Verify normal Vertex WIF still succeeds after container deployment.

### Phase 3 gate

- [x] Azure reports Trusted Launch/Secure Boot/vTPM and automatic patching enabled. `(live)`
- [ ] No public inbound VM port is open.
- [ ] The restricted container is healthy and IMDS SSRF tests remain blocked while Vertex authentication works.

---

## Phase 4 — Logs and Terraform State

### Logs

- [x] Add structured redaction for authorization headers, cookies, credentials, database URLs, webhook URLs, signed URLs, and nested error/context fields. `(working tree)`
- [x] Add tests proving representative secrets never reach stdout or the JSONL sink. `(working tree; tests pass)`
- [x] Replace public raw-container-log output with a sanitized failure message directing operators to Log Analytics. `(working tree)`
- [x] Confirm Grafana has only `Reader` on `tomoribot-rg` and `Log Analytics Reader` on `tomoribot-logs`. `(live)`
- [x] Keep Log Analytics retention at 30 days. `(live)`
- [x] Document that `RawData` remains access-controlled for troubleshooting; revisit removal only if parsed columns prove sufficient. `(working tree)`
- [x] Use GitHub Actions run status for deployment failures, preserve the existing Discord release-success notification, and defer new failure notifications or alert rules until an observed failure mode justifies them. `(decision)`

### Terraform state

- [x] Enforce HTTPS, TLS 1.2, disabled anonymous access, and Entra-only authorization on `tomoribottfstate`. `(live)`
- [x] Enable blob versioning plus 30-day blob/container soft delete. `(live)`
- [x] Add the `CanNotDelete` state-account lock and Blob read/write/delete/transaction diagnostics. `(live)`
- [x] Verify local Entra-backed `terraform init` and state read. `(live)`
- [x] Keep the storage public endpoint because deployments use GitHub-hosted runners; authorization remains Entra-only and scoped. `(decision)`
- [x] Audit final blob data-plane assignments: only the designated operator at account scope and GitHub deployment principal at container scope have Blob Data Contributor. `(live)`
- [x] Document state-version restore and stale-lock recovery without performing a production rollback in this change. `(working tree)`

### Phase 4 gate

- [x] Redaction tests and the sanitized workflow failure path pass local validation. `(working tree)`
- [x] State access contains only expected principals and recovery steps are documented. `(live access audit plus working-tree recovery runbook)`

---

## Phase 5 — Reproducibility and Quality Gates

- [x] Pin Terraform `1.14.3` plus AzureRM `4.81.0`. `(working tree)`
- [x] Commit the generated `terraform/azure/.terraform.lock.hcl`. `(included in the hardening commit)`
- [x] Pin external GitHub Actions to full commit SHAs and enforce the repository policy. `(working tree and live policy)`
- [x] Pin Bun and optional SearXNG base images by reviewed digest. `(working tree)`
- [x] Configure TomoriBot and SearXNG deployment by immutable image digest while retaining readable tags. `(working tree; production deployment remains Phase 6)`
- [x] Verify cached Python wheels against the checked-in SHA-256 manifest. `(working tree)`
- [x] Record that tokenizer assets currently download from unpinned Hugging Face `resolve/main` revisions; pinning them is deferred to the follow-up backlog rather than misreporting existing hash verification. `(decision)`
- [x] Defer SBOM/provenance publishing to a separate supply-chain project. `(decision)`
- [x] Run `bun run check`. `(passed)`
- [x] Run `bun run lint`. `(passed; 1035 files checked)`
- [x] Record that `bun run check-locales` is not required because this change does not modify locale or command metadata. `(decision)`
- [x] Run focused TLS, schema-mode, logger-redaction, and URL-safety unit tests. `(18 passed, including socket-level DNS pinning)`
- [x] Run `terraform fmt -check` and `terraform validate` in `terraform/azure`. `(passed)`
- [x] Run ShellCheck on the current `deploy/azure/run-command-deploy.sh`. `(passed)`
- [x] Resolve the remaining `actionlint`-reported shell findings, then validate the bootstrap and lockdown scripts with ShellCheck. `(passed across all workflows and all three Azure lifecycle scripts)`

---

## Phase 6 — Reviewed Deployment and Final Proof

- [x] Open a PR from a hardening branch and let the required `validate` check pass. `(PR #51; required validate check passed. Two optional pull_request_target jobs are rejected because the release-base copies still use movable action tags; the PR head pins those actions, so no second PR is needed.)`
- [ ] Merge through the protected branch; do not bypass the ruleset.
- [ ] Complete one environment-gated production deployment through OIDC and Run Command.
- [ ] Verify `/healthz`, Discord connectivity, private database access/TLS, Vertex WIF, URL-fetch blocking, and one representative slash command.
- [ ] Run the one-time host lockdown, remove the NSG SSH rule, and verify ports `22`, `5432`, `8080`, `8081`, and `11235` are not publicly reachable.
- [ ] Re-verify after deployment that the app uses private PostgreSQL and the sole public firewall exception remains the Grafana `/32`; the VM public-IP rule is already removed.
- [ ] Remove the old branch federated credential, subscription `Contributor`, repository PAT, and obsolete SSH private-key secret.
- [ ] Review Azure Activity Log and Defender/Advisor once for material unexplained findings; do not treat generic recommendations as blockers.
- [ ] Confirm the VM, NIC, public IP, NSG, PostgreSQL server, private endpoint/DNS, workspace/DCR, and state account report successful provisioning.
- [ ] Confirm no unexplained public IP, disk, NIC, snapshot, credential, or deployment principal remains.
- [x] Update affected `docs/architecture/cloud/` pages with the deployment, database, identity, logging, state, and recovery behavior. `(working tree; docs build passes)`

## Completion Criteria

The simplified plan is complete when:

1. A reviewed production deployment succeeds with environment-scoped OIDC and without SSH.
2. GitHub's Azure principal is limited to `tomoribot-rg` plus the `tfstate` container, and obsolete branch/PAT/SSH trust is removed.
3. TomoriBot uses the PostgreSQL private endpoint and non-admin runtime login with verified TLS; public database ingress is limited to the dedicated read-only Grafana login's exact `/32`.
4. Trusted Launch, automatic patching, the restricted container, log redaction, and IMDS blocking are active and verified.
5. Terraform state is Entra-only, versioned, soft-delete protected, locked against deletion, and has documented recovery steps.
6. Required local quality gates pass and the production bot is healthy.
7. Cloud architecture documentation matches the final implementation.

## Follow-up Backlog (Not Completion Blockers)

- Rotate individual provider/application credentials when compromise, expiry, or provider policy requires it.
- Evaluate Key Vault and tighter R2 scope during a dedicated secrets-management review.
- Add targeted security alerts after real operational signals and response ownership exist.
- Run scheduled PostgreSQL restore and Terraform state recovery drills.
- Evaluate SBOM/provenance publication.
- Pin tokenizer assets to immutable Hugging Face revisions and checksums if reproducible tokenizer downloads become a release requirement.
- Move Grafana behind a private/VPN path later if eliminating its single public database `/32` becomes worth the added infrastructure.

## Primary References

- [Azure PostgreSQL access control](https://learn.microsoft.com/azure/postgresql/security/security-access-control)
- [Azure PostgreSQL private networking](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-networking-private-link)
- [Azure PostgreSQL TLS](https://learn.microsoft.com/azure/postgresql/security/security-tls-how-to-connect)
- [Azure automatic VM guest patching](https://learn.microsoft.com/azure/virtual-machines/automatic-vm-guest-patching)
- [Azure Trusted Launch](https://learn.microsoft.com/azure/virtual-machines/trusted-launch-existing-vm)
- [Terraform state in Azure Storage](https://learn.microsoft.com/azure/developer/terraform/store-state-in-azure-storage)
- [GitHub OIDC for Azure](https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-azure)
- [GitHub deployment environments](https://docs.github.com/actions/reference/workflows-and-actions/deployments-and-environments)
