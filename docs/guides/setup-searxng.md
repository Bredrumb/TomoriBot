# Setup: SearXNG Web Search Sidecar

The `web_search` tool routes through an engine chain: **Brave → SearXNG → DuckDuckGo → Felo**. By running our own instance of SearXNG, we sidestep single-engine rate limits and scrape breakage, and unlock SearXNG-only vertical categories: `science`, `it`, `files`, and `music`.

There are three ways to set up SearXNG locally:

### 1. Docker Compose (Recommended)
First, set `SEARXNG_SECRET` in `.env` to any 32+ char string for production (it's auto-defaulted in dev).

Then run with the `searxng` profile:
```sh
docker compose --profile searxng up -d
```
This starts the `searxng` service alongside TomoriBot — the bot reaches it at `http://searxng:8080/` automatically.

---

### 2. Standalone Docker (when running `bun run dev`)
If you are running TomoriBot directly with `bun run dev`, use `bun launch --searxng` instead — it handles the container lifecycle automatically and waits for the container to be healthy before starting the bot:

```sh
bun launch --searxng
```

Set `SEARXNG_BASE_URL=http://localhost:8080/` in `.env` so the bot connects to it.

If you prefer to manage the container yourself, set `SEARXNG_BASE_URL=http://localhost:8080/` in `.env` and run:

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

### 3. No SearXNG
Leave `SEARXNG_BASE_URL` unset — the chain falls back to `Brave → DDG → Felo` exactly as before. Nothing breaks.

SearXNG-only categories return the normal "category unavailable" message when no SearXNG sidecar is configured. The common categories (`text`, `image`, `video`, `news`) still work through Brave when a Brave API key is configured.

*Note: Per-engine timeout and the health-probe cache duration are tunable via `WEB_SEARCH_TIMEOUT_MS` and `WEB_SEARCH_HEALTHCHECK_CACHE_SEC` (see `.env.optional.example`).*
