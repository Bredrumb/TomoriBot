---
title: "Setup: Crawl4AI (Sidecar)"
sidebar:
  order: 4
---
# Setup: Crawl4AI Sidecar

The `fetch_url` tool can optionally try a browser-rendering sidecar before falling back to the bundled MCP fetch engine. Use it when you want rendered content for JS-heavy pages.

Default engine order is `crawl4ai,mcp_fetch`.

Crawl4AI is a browser-rendered markdown sidecar. It runs a Playwright-based headless browser and extracts LLM-friendly markdown server-side using its own content filters — no post-processing needed on TomoriBot's side.

Choose one Crawl4AI setup path:

### A. Docker Compose (when TomoriBot runs in Docker)

Use this path if you run TomoriBot with the repo's Docker Compose stack. First, set `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` in `.env`.

Then, start with:

```sh
docker compose --profile fetch-crawl4ai up -d
```

This starts the Compose stack with the Crawl4AI sidecar on TomoriBot's Docker network.

If you run TomoriBot directly with `bun run dev`, use the standalone path below instead.

If you also want the SearXNG sidecar, chain the profiles:

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

If you enable Crawl4AI API-token auth, set `CRAWL4AI_TOKEN` in `.env`; Compose passes it to the container as `CRAWL4AI_API_TOKEN`, and TomoriBot sends it as a bearer token.

---

### B. Standalone Docker (when running `bun run dev`)

First, set `CRAWL4AI_BASE_URL=http://localhost:11235/` in `.env` so the bot connects to the host-published container port.

Then, instead of running TomoriBot directly with `bun run dev`, use `bun run launch --crawl4ai`. This handles the container lifecycle automatically and waits for the sidecar to be healthy before starting the bot:

```sh
bun run launch --crawl4ai
```

If you also want the SearXNG sidecar:

```sh
bun run launch --searxng --crawl4ai
```

If you prefer to manage the container yourself, keep `CRAWL4AI_BASE_URL=http://localhost:11235/` in `.env` and run:

**PowerShell:**

```powershell
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g `
  unclecode/crawl4ai:latest
```

**Bash (Linux/macOS):**

```bash
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g \
  unclecode/crawl4ai:latest
```

If you secure the sidecar, pass `-e CRAWL4AI_API_TOKEN=your_token` to `docker run` and set `CRAWL4AI_TOKEN=your_token` in `.env`.

Then run `bun run dev` once the container is healthy (`docker ps` shows `(healthy)`).

---

### C. No Browser Sidecar

Leave `CRAWL4AI_BASE_URL` unset. The `fetch_url` tool will cleanly fall back to the bundled `mcp_fetch` engine.

---

## Starting Order (Important)

TomoriBot probes sidecar health on the **first `fetch_url` call after startup** and caches the result for 60 seconds. If the container isn't ready when that first probe fires, the bot treats it as unavailable for the next minute.

For standalone Docker, start your sidecar container before starting TomoriBot. `bun run launch --crawl4ai` already does this for you.

### First-time setup

1. Start the container and wait until it shows `(healthy)` in `docker ps`:
   ```powershell
   docker ps
   ```
2. Set `CRAWL4AI_BASE_URL` in `.env` using the value for your setup path above.
3. Start TomoriBot (`bun run dev` or `docker compose up`).

### Returning after a restart

If the container already exists from a previous run, use `docker start` instead of `docker run` to avoid a naming conflict:

```powershell
# Start an existing container
docker start crawl4ai

# Confirm healthy before starting TomoriBot
docker ps
```

Then start TomoriBot as normal. Restarting `bun run dev` resets the in-memory health cache, so as long as the container is ready first the correct engine will be picked up immediately.

---

## Cookie Injection (Authenticated Fetches — Optional)

Crawl4AI supports injecting browser-level cookies so the headless browser appears already logged in when fetching a page. This is useful for sites that require a session to view content (e.g. paywalled news, private forums, login-gated dashboards).

The MCP fetch fallback does **not** support cookie injection — cookies only apply when Crawl4AI is active.

> **Limitation:** Cookie injection bypasses login walls but not bot fingerprinting. Sites with aggressive anti-bot detection (notably Twitter/X) detect headless Playwright via canvas/WebGL fingerprinting and serve empty pages even with valid session cookies. Cookie injection works well for sites that gate on authentication alone.

### Getting your cookies

1. Open your browser and log in to the target site.
2. Open DevTools (`F12`) → **Application** tab → **Storage** → **Cookies** → select the site's domain.
3. Copy the `Value` of each required cookie (typically a session token — check the site's cookie names).

### Crawl4AI

Set `CRAWL4AI_COOKIES_JSON` in `.env` as a JSON array:

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

When this is set, `fetch_url` automatically switches from the `/md` endpoint to `/crawl` with `browser_config.cookies` — `/md` does not support cookie injection.

### Cookie object fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Cookie name |
| `value` | Yes | Cookie value |
| `domain` | No | Domain scope (e.g. `.x.com`). Recommended for correctness. |
| `path` | No | Path scope. Defaults to `/` if omitted. |

> **Note:** Cookie values are sensitive — treat them like passwords. They grant full session access to your account. Do not commit `.env` to version control.

---

## Engine Order & Env Vars

| Variable | Default | Description |
|---|---|---|
| `CRAWL4AI_BASE_URL` | unset | Enables Crawl4AI when set. Use `http://crawl4ai:11235/` from Docker Compose, or `http://localhost:11235/` when TomoriBot runs directly on your machine. |
| `CRAWL4AI_TOKEN` | unset | Optional bearer token. Must match `CRAWL4AI_API_TOKEN` on the Crawl4AI container when enabled. |
| `FETCH_URL_ENGINE_ORDER` | `crawl4ai,mcp_fetch` | Comma-separated engine list. Unknown names are ignored, duplicates are collapsed, and `mcp_fetch` is always appended as the final fallback. |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Per-engine request timeout for Crawl4AI and URL-fetch sidecars. |
| `FETCH_URL_HEALTHCHECK_CACHE_SEC` | `60` | How long the Crawl4AI health probe result is cached before re-checking. |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | Set to `true` to allow fetching localhost/private/internal URLs (development only). |
| `FETCH_URL_FILTER_MODE` | `fit` | Crawl4AI `/md` filter mode. `fit` keeps markdown cleaner for LLM use; `fetch_url(..., raw=true)` overrides it per request. |
