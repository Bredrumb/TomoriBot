---
title: "Setup: SearXNG Web Search Sidecar"
---
# Setup: SearXNG Web Search Sidecar

The `web_search` tool routes through an engine chain: **Brave → SearXNG → DuckDuckGo → Felo**. By running our own instance of SearXNG, we sidestep single-engine rate limits and scrape breakage, and unlock SearXNG-only categories: `science`, `it`, `files`, and `music`.

There are three ways to set up SearXNG locally:

### 1. Docker Compose (Recommended)
Then run with the `searxng` profile:
```sh
docker compose --profile searxng up -d
```
This starts the `searxng` service alongside TomoriBot — the bot reaches it at `http://searxng:8080/` automatically.

If using production, set `SEARXNG_SECRET` in `.env` to any 32+ char string (it's auto-defaulted in dev).

---

### 2. Standalone Docker (when running `bun run dev`)
First, set `SEARXNG_BASE_URL=http://localhost:8080/` in `.env` so the bot knows where to connect.

Then, instead of running TomoriBot directly with `bun run dev`, use `bun run launch --searxng`. This handles the container lifecycle automatically and waits for the container to be healthy before starting the bot:

```sh
bun run launch --searxng
```

If you prefer to manage the container yourself, keep `SEARXNG_BASE_URL=http://localhost:8080/` in `.env` and run:

**PowerShell:**
```powershell
docker run -d --name searxng -p 8080:8080 `
  -v "${PWD}/servers/searxng:/etc/searxng:rw" `
  -e SEARXNG_SECRET=dev-only-not-for-production `
  searxng/searxng:latest
```

**Bash (Linux/macOS):**
```bash
docker run -d --name searxng -p 8080:8080 \
  -v "${PWD}/servers/searxng:/etc/searxng:rw" \
  -e SEARXNG_SECRET=dev-only-not-for-production \
  searxng/searxng:latest
```

Then run `bun run dev` once the container is healthy (`docker ps` shows `(healthy)`).

---

### 3. AWS ECS

Add SearXNG as a sidecar container in the same task definition. Set `SEARXNG_BASE_URL=http://localhost:8080/` on the app container and make it depend on the sidecar's healthcheck. Inject `SEARXNG_SECRET` via Secrets Manager.

### 4. GCP Cloud Run

GCP Terraform keeps the SearXNG sidecar disabled by default to avoid paying for an always-on Cloud Run sidecar:

```hcl
enable_searxng_sidecar = false
```

To run it in the same Cloud Run service, set `enable_searxng_sidecar = true`. Terraform then adds the SearXNG container, injects `SEARXNG_SECRET` through Secret Manager, and sets `SEARXNG_BASE_URL=http://localhost:8080/` on the bot container. For production, override `searxng_image` with a pinned digest instead of `searxng/searxng:latest`.

---

### 5. No SearXNG
Leave `SEARXNG_BASE_URL` unset — the chain falls back to `Brave → DDG → Felo` exactly as before. Nothing breaks.

When no SearXNG sidecar is configured, the assembled `web_search` schema no longer advertises SearXNG-only categories. The common categories (`text`, `image`, `video`, `news`) still appear when Brave is configured, and text-only search appears when only DDG/Felo MCP fallback is available.

---

## Image Result Tuning

SearXNG image results are HEAD-validated, optionally compressed, and posted as Discord attachments — identical UX to Brave images. If all candidate URLs fail validation, SearXNG returns a text listing of image links instead of a hard failure.

| Variable | Default | Description |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3` (max 10) | How many valid images are sent to Discord. Overridden by the LLM's `count` arg. |
| `SEARXNG_IMAGE_POOL` | `10` | Candidate URL pool when the LLM does not specify `count`. When `count` is specified, the pool is `count × 3` (capped at 30) to absorb hotlink-protection failures. |
| `IMAGE_MIN_SIZE_BYTES` | `5120` (5 KB) | Images below this size are rejected — filters placeholder/error images. Shared with Brave image search. |
| `WEB_SEARCH_TIMEOUT_MS` | — | Per-engine request timeout. |
| `WEB_SEARCH_HEALTHCHECK_CACHE_SEC` | `60` | How long the health probe result is cached before re-checking. |

*(See `.env.optional.example` for all tunables.)*
