---
title: "Setup: Crawl4AI Sidecar"
sidebar:
  order: 7
---
# Setup: Crawl4AI Sidecar

The `fetch_url` tool can optionally try a browser-rendering sidecar before falling back to the bundled MCP fetch engine. Use it when you want rendered content for JS-heavy pages.

Default engine order is `crawl4ai,mcp_fetch`.

---

## 1. Crawl4AI Sidecar

Crawl4AI is a browser-rendered markdown sidecar. It runs a Playwright-based headless browser and extracts LLM-friendly markdown server-side using its own content filters — no post-processing needed on TomoriBot's side.

**Docker Compose (Recommended):**
First, set `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` in `.env`.
Then, start with:
```sh
docker compose --profile fetch-crawl4ai up -d
```

*(If you also want to run the SearXNG sidecar at the same time, you can chain the profiles: `docker compose --profile searxng --profile fetch-crawl4ai up -d`)*

**Standalone Docker (for `bun run dev`):**
If running TomoriBot directly on your machine, you can run the sidecar in a separate container.
Set `CRAWL4AI_BASE_URL=http://localhost:11235/` in your `.env`.
Run the container:

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
*(If you wish to secure it, pass `-e CRAWL4AI_API_TOKEN=your_token` to docker and set `CRAWL4AI_TOKEN=your_token` in `.env`).*

---

## 2. Starting Order (Important)

TomoriBot probes sidecar health on the **first `fetch_url` call after startup** and caches the result for 60 seconds. If the container isn't ready when that first probe fires, the bot treats it as unavailable for the next minute.

**Always start your sidecar container before starting TomoriBot.**

### First-time setup

1. Start the container and wait until it shows `(healthy)` in `docker ps`:
   ```powershell
   docker ps
   ```
2. Set `CRAWL4AI_BASE_URL` in `.env` (see section 1 above).
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

## 3. Cookie Injection (Authenticated Fetches — Optional)

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

## 4. Engine Order & Env Vars

| Variable | Default | Description |
|---|---|---|
| `FETCH_URL_ENGINE_ORDER` | `crawl4ai,mcp_fetch` | Comma-separated engine list. Unknown names are ignored, duplicates are collapsed, and `mcp_fetch` is always appended as the final fallback. |
| `FETCH_URL_HEALTHCHECK_CACHE_SEC` | `60` | How long the Crawl4AI health probe result is cached before re-checking. |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | Set to `true` to allow fetching localhost/private/internal URLs (development only). |

## 5. No Browser Sidecar

Leave `CRAWL4AI_BASE_URL` unset. The `fetch_url` tool will cleanly fall back to the bundled `mcp_fetch` engine.
