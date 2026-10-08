---
title: "Security & Privacy"
---

The security and privacy subsystem enforces trust boundaries across environment secrets, database encryption, remote network fetches, and Discord user privacy. It isolates infrastructure credentials, encrypts API keys at rest with versioned keys, guards against SSRF attacks on user-supplied URLs, and protects user data through tiered privacy levels and server blacklists.

## Secrets management and environment isolation

Application secrets are managed by `src/utils/security/secretsManager.ts` during startup in `src/index.ts`.

- **Resolution hierarchy**:
  1. Development environments (`RUN_ENV != "production"` or `TEST_PRODUCTION=true`): loads values from `.env`.
  2. Production with `SECRET_FILE`: reads mounted JSON secret file (such as `/run/secrets/tomoribot.json` in Azure or Docker Compose).
  3. Production with `GCP_SECRET_FILE`: reads mounted GCP Secret Manager volume file (legacy Cloud Run).
  4. Production fallback: queries AWS Secrets Manager (`tomoribot/production`, region from `AWS_REGION`, default `us-east-1`).
- **Startup validation**: the loader verifies core database credentials (`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`), Discord authentication (`DISCORD_TOKEN`), and at least one encryption key (`CRYPTO_SECRET` or a versioned key).
- **Environment mapping**: verified secrets populate `process.env`. `CryptoKeyManager.initialize()` executes immediately after secret loading so encryption keys are ready before database connection initialization. The selected secret source replaces the entire encryption-version set, including `CRYPTO_SECRET_CURRENT`; undeclared ambient versions are cleared. Runtime and maintenance scripts use this same loader.
- **Subprocess arguments**: other local users can read a process's command line, so secrets never go there. `withPostgresPassfile()` in `src/utils/backup/dataBackup.ts` gives `pg_dump` and `psql` the database password through a private temporary `PGPASSFILE` and removes the bot's own database credential variables from their environment. The OpenRouter video `curl` fallback reads its headers and body from stdin (`-K -`).
- **Log redaction**: every `log` method, including `log.metric`, passes its fields through `sanitizeLogPayload()` before either sink, so free-text values such as endpoint failure reasons get the same credential redaction as structured fields. Numeric fields keep their type.

## Encryption at rest and key rotation

External provider API keys stored in PostgreSQL are encrypted using symmetric cryptography via PostgreSQL `pgcrypto` (`pgp_sym_encrypt` with AES-256 and compression).

- **Storage format**: encrypted keys are stored as `BYTEA` alongside an integer `key_version`.
- **Inventory**: `src/utils/security/encryptedColumns.ts` owns the columns shared by audit, rotation, and backup recovery checks: saved server and personal provider credentials, rotation pool members, optional API keys, MCP auth tokens, managed webhook tokens, and the legacy `server_model_configs.api_key` mirror while it exists. Null ciphertext and main-key pointer rows are skipped. Null version tags mean V1.
- **Key selection**: all `CRYPTO_SECRET_V<positive integer>` fields are loaded. Legacy `CRYPTO_SECRET` supplies V1 unless `CRYPTO_SECRET_V1` is present. New writes use `CRYPTO_SECRET_CURRENT` or the highest available version. JSON sources accept the current version as a string or numeric positive safe integer; master keys must be strings. Invalid or unavailable current versions stop initialization before writes.
- **Decryption**: each row requires the key matching its stored version. Conversion can go directly from any retained version to the current one; versions need not be consecutive.
- **Audit and rotation**: `bun run audit-keys` and `bun run rotate-keys --dry-run` check actual decryptability across the inventory. Audit reports secret-free table, column, row ID, and version failure context and continues checking later credentials. Incomplete queries, missing or wrong keys, and failed rows produce a non-zero exit. Rotation uses atomic conditional updates of ciphertext and version, refusing rows changed since the scan. It normalizes null V1 tags even when V1 is current. Successful earlier updates remain committed after partial failure.
- **Process caches**: stop every bot instance before `bun run rotate-keys --bot-stopped`, audit afterward, then restart all instances. A separate script cannot invalidate another process's caches. See [Maintenance & Backups](/self-hosting/maintenance/#rotating-encryption-keys) for the operator procedure.
- **Backup recovery**: new bundles contain the database dump and a version inventory, with no secret configuration. Restore enables `pgcrypto` on the target and then decrypts every credential in the dump using separately provisioned keys before loading SQL. Extension setup failure is reported separately and stops recovery. Legacy bundles still contain raw `config.env` secrets; restore warns and leaves that file untouched. Keep a protected key archive separate from retained backups. A live-row audit cannot establish that old backups are recoverable.

## Provider API key pool and failover

Server-wide provider keys support pooled failover and load balancing via `src/utils/security/keyRotation.ts`:

- **Key rotation table**: `api_key_rotation` stores encrypted keys and provider bindings. Telemetry is tracked in `api_key_rotation_runtime_state`.
- **Selection**: keys are selected by lowest `usage_count` across healthy pool members.
- **Error cooldowns**: keys that encounter rate limits enter a 60-second cooldown. Keys with general API errors enter a 5-minute cooldown.
- **Main key pointer**: each provider maintains a primary pointer (`is_main_key_pointer = true`) so the server's primary credential participates in rotation without coupling to other providers.
- **Personal scope isolation**: personal provider credentials (`/personal providers`) bypass rotation pools entirely. They edit the user's primary saved credential directly and never read or write server rotation rows.

## Privacy model and participant protection

The privacy subsystem balances contextual AI personalization against user consent and data minimization.

### Global privacy levels

Configured via `/personal config` and persisted in `users.privacy_level`:

- **Level 0 (`MINIMAL`)**: full personalization context. Includes roles, status, and personal memories when permitted.
- **Level 1 (`PARTIAL`)**: reduced personalization. Excludes status, roles, and personal memories from prompt assembly.
- **Level 2 (`FULL`)**: maximum privacy posture.
  - Messages from level-2 users are filtered out of conversation history context.
  - Non-manual chat triggers silently ignore the user in `messageCreate`.
  - Participant reference discovery suppresses saved nicknames from output mentions, tool targets, and prompt projections.

### Server-scoped blacklists

Managed via `/moderation` and persisted in `personalization_blacklist`:

- Keyed by `(server_id, user_disc_id)`.
- Excludes the user from personalization enrichments within that guild.
- Does not affect account existence or global interactions outside that server.
- Extension enrichers receive cloned, privacy-filtered core fields; they cannot restore suppressed names, memories, presence, roles, or physical appearance.

### Persona user moderation

`persona_user_blocks` stores persona-scoped moderation records:

- Keyed by `(server_id, persona_id, user_disc_id)`.
- `mute`: prevents the user from triggering the persona.
- `block`: prevents triggers and hides the target's recent messages from the persona's conversation history context.
- Does not alter stored memory rows or trigger data deletion.

## SQL injection protections

TomoriBot prevents SQL injection through query parameterization and identifier allowlists:

- **Parameterized templates**: queries use Bun SQL templates or explicitly parameterized `sql.unsafe()` calls, passing untrusted values out of band. Raw SQL text is reserved for owned schema statements and validated identifiers.
- **Dynamic identifier allowlists**: dynamic column updates pass through explicit allowlists in `src/utils/db/sqlSecurity.ts` (`validateUserFields`, `validateTomoriFields`, `validateTomoriConfigFields`). Unrecognized field names throw validation errors before query construction.

## SSRF and remote URL security gate
<!-- anchor: ssrf-and-remote-url-security-gate -->

Guild MCP servers, custom LLM endpoints, and `safeDownload()` media requests use `remoteUrlSecurity.ts` and the DNS-pinned `userRemoteFetch.ts`. The `fetch_url` tool also validates inputs through `src/tools/fetchUrl/urlSafety.ts`, because its optional Crawl4AI engine runs outside this process. The guards share production policy and the cloud metadata denylist.

### Security constraints

- **Production HTTPS requirement**: in production (`RUN_ENV=production`), all endpoints must use HTTPS (`PRODUCTION_HTTPS_REQUIRED`). Plain HTTP is rejected.
- **Localhost and private IP blocking**: production defaults reject private and reserved targets. `allowPrivateNetwork` relaxes this blocklist for authorized callers; `strict` enforces it in every environment and takes precedence. `fetch_url` exposes its deployment opt-in through `FETCH_URL_ALLOW_PRIVATE_NETWORK`. Neither exception permits cloud metadata access.
- **Cloud metadata denylist**: requests to cloud instance metadata services (such as `169.254.169.254` and `metadata.google.internal`) are blocked across all environments via `src/utils/security/cloudMetadata.ts`. The guarantee covers requests this process sends. Crawl4AI's browser is outside it; see the redirect item below.
- **Unresolvable hosts**: `fetch_url` refuses a hostname that fails to resolve or resolves to no address, in every environment, because the metadata denylist cannot judge an address it never saw.
- **Pinned DNS resolution**: `fetchUserRemoteUrl()` resolves the hostname once, validates the resulting IP addresses against policy, and pins the socket connection directly to the validated IP. This eliminates DNS rebinding time-of-check to time-of-use (TOCTOU) attacks.
- **Redirect revalidation**: the pinned fetcher resolves and validates each redirect before following it, with a default maximum of three hops (`USER_REMOTE_FETCH_MAX_REDIRECTS`). Guild MCP transports reject redirects. Crawl4AI handles redirects, DNS, and subresources externally and is enabled only where private-network fetching is permitted; it does not provide the pinned fetcher's per-hop guarantee. The bot preflight cannot pin the browser's DNS. The pinned Crawl4AI image applies its own non-global destination block unless `CRAWL4AI_ALLOW_INTERNAL_URLS=true`, which TomoriBot cannot verify at runtime. Crawl4AI response and error bodies are read with byte limits and shape checks before use.

The Matrix bridge sends its appservice token only to the configured homeserver. Media identifiers are validated before the token is attached, and a media redirect is followed anonymously through `safeDownload`. See [Matrix bridge](/architecture/integrations/matrix/bridge/#media-downloads) for identifier validation, listener exposure, and the room encryption gate.

Guild MCP Streamable HTTP and SSE responses are capped at 4 MiB before SDK parsing, including discovery and internal rule-checker calls. Requests stay on the registered origin; Smithery managed-key connections are disabled until they can enforce the same controls. Arbitrary administrator-selected remote services own their downstream network work. Schema-identified URL inputs receive a bot preflight, which cannot enforce the remote service's DNS, redirects, or download limits. See [Tool system](/architecture/subsystems/tool-system/) for replacement routing and recovery.

Tool dispatch rechecks provider/model support, declared flags, live context, and bot permissions. Invoking-user authorization and quotas remain in the owning tool. Status prompt and context previews use `canViewPromptText` on each interaction. Persona and Matrix relay identity require a managed webhook ID bound to the guild/channel before any name matching or admission exemption; repository failures grant no trust.
- **Redirect credentials**: a configured credential belongs to one origin (scheme, hostname, and effective port), and a redirect response cannot extend that trust. Same-origin redirects keep every header and their method semantics. At an origin change the fetcher keeps only a short list of non-credential headers (`Accept`, `Accept-Language`, `Content-Language`, `Content-Type`, `User-Agent`) and follows anonymously, so signed asset URLs still download. Dropped headers are never reattached on a later hop. A credentialed HTTPS to HTTP downgrade, or a cross-origin target that embeds a username or password, is refused before anything is sent. When the new origin answers an anonymous follow with 401, 403, or 407, the fetcher throws `RemoteUrlPolicyError` with `REDIRECT_CREDENTIALS_WITHHELD`; custom chat and endpoint setup turn it into a localized message telling the owner to enter the endpoint's final URL directly.
- **Discord attachments**: attachment and CDN URLs are signed and download anonymously through `safeDownload()`. No download path attaches the bot token.
- **Policy refusals**: deliberate policy rejections throw `RemoteUrlPolicyError`, logged at `warn` level with `error: "blocked_by_policy"`. These rejections represent expected policy enforcement rather than system failures, keeping them out of incident alerts and `error_logs`.

## Runtime guardrails and anti-abuse

- **Cooldown system**: rate-limits slash commands by category and message triggers by user, channel, or guild.
- **Generation quotas**: text, image, and video generation quotas tracked by `QuotaRepository` prevent token and resource exhaustion.
- **Stream flood guard**: limits streaming update chunks via `STREAMING_LIMITS.MAX_FLUSH_COUNT`.
- **Memory pressure guard**: `memoryGuard` monitors container RSS. Approaching critical thresholds initiates `clearEmergencyCaches()` and forced garbage collection.
- **Bounded media downloads**: `safeDownload()` enforces byte ceilings, timeouts, and content-type validation for external attachments, avatar imports, and provider media.

## Supply chain security

- **Deterministic lockfiles**: builds use `--frozen-lockfile` with strict dependency pinning.
- **Pinned runtime images**: production Docker containers pin Bun base images by digest; GitHub Actions workflows pin external actions by full commit SHA.
- **No bundled MCP processes**: the bot starts no local or stdio MCP server. Default search and page reading run in process; MCP tools come only from administrator-registered remote guild servers.
- **Dependency audits**: continuous integration enforces `bun audit` and container vulnerability scanning.
- **OIDC authentication**: production deployment workflows use short-lived OIDC tokens for cloud provider authentication rather than static credentials.

## Source pointers

- `src/utils/security/secretsManager.ts`: secret loading, environment resolution, and startup validation.
- `src/utils/security/crypto.ts`: `pgcrypto` symmetric encryption and decryption.
- `src/utils/security/keyManager.ts`: encryption key version discovery and rotation.
- `src/utils/security/keyRotation.ts`: provider API key pool failover and error cooldowns.
- `src/utils/security/remoteUrlSecurity.ts`: centralized SSRF validation gate and IP classification.
- `src/utils/security/userRemoteFetch.ts`: pinned-DNS fetch implementation and redirect revalidation.
- `src/utils/security/safeDownload.ts`: bounded media download wrapper.
- `src/utils/db/sqlSecurity.ts`: SQL identifier validation and allowlists.
- `src/db/schema.sql`: encrypted credential storage definitions.
