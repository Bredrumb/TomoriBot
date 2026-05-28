# Setup: SearXNG Web Search Sidecar

The `web_search` tool routes through an engine chain: **Brave → SearXNG → DuckDuckGo → Felo**. By running our own instance of SearXNG, we sidestep single-engine rate limits and scrape breakage.

There are three ways to set up SearXNG locally:

### 1. Docker Compose (Recommended)
First, set `SEARXNG_SECRET` in `.env` to any 32+ char string for production (it's auto-defaulted in dev). 

Then run:
```sh
docker compose up -d
```
This starts the `searxng` service alongside TomoriBot automatically — the bot reaches it at `http://searxng:8080/`.

---

### 2. Standalone Docker (when running `bun run dev`)
If you are running TomoriBot directly with `bun run dev` (not using Docker Compose for the bot), you can still spin up SearXNG in a container.

First, set the following variable in your `.env` file:
```env
SEARXNG_BASE_URL=http://localhost:8080/
```

Then, run this exact command to start the SearXNG container:

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

After the container starts, simply run `bun run dev` to start TomoriBot. She will automatically detect `SEARXNG_BASE_URL` and use it.

---

### 3. No SearXNG
Leave `SEARXNG_BASE_URL` unset — the chain falls back to `Brave → DDG → Felo` exactly as before. Nothing breaks.

*Note: Per-engine timeout and the health-probe cache duration are tunable via `WEB_SEARCH_TIMEOUT_MS` and `WEB_SEARCH_HEALTHCHECK_CACHE_SEC` (see `.env.optional.example`).*