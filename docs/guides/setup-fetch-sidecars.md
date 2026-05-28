# Setup: URL Fetch Sidecars (Crawl4AI & Browserless)

The `fetch_url` tool can optionally try browser-rendering sidecars before falling back to the bundled MCP fetch engine. Use them when you want rendered content for JS-heavy pages.

Default engine order is `crawl4ai,browserless,mcp_fetch`.

## Choosing a sidecar

| | Crawl4AI | Browserless |
|---|---|---|
| **What it returns** | Markdown (server-side extraction) | Raw rendered HTML (TomoriBot converts locally) |
| **Content quality** | Higher — purpose-built for LLM-ready output with `fit`/`bm25`/`llm` filter modes | Good — Readability + Turndown applied by TomoriBot after render |
| **Best for** | Article-heavy sites, blogs, documentation, Reddit-style threads | JS-heavy SPAs, sites where Crawl4AI's extraction is too aggressive |
| **Cookie injection** | Switches to `/crawl` endpoint (endpoint change required) | Inline in `/content` request (no endpoint change) |
| **Resource usage** | Heavy under load — Python + ML pipeline (Idles ~300MB, needs `--shm-size=3g` buffer to prevent crashes on large pages) | Light under load — lean Node.js Chrome pool (Idles ~200MB, needs `--shm-size=2g` buffer to prevent crashes on large pages) |
| **License** | Apache 2.0 — free for all use | SSPL — review terms before commercial/proprietary deployment |
| **Chain position** | Tried first | Tried second, before MCP fetch |

**Recommendation:** run Crawl4AI as your primary sidecar. Add Browserless only if you need a fallback for sites where Crawl4AI's content extraction produces poor results.

---

## 1. Crawl4AI Sidecar
Crawl4AI is a browser-rendered markdown sidecar. It runs a Playwright-based headless browser and extracts LLM-friendly markdown server-side using its own content filters — no post-processing needed on TomoriBot's side.

**Docker Compose (Recommended):**
First, set `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` in `.env`. 
Then, start with:
```sh
docker compose --profile fetch-crawl4ai up -d
```

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

## 2. Browserless Sidecar
Browserless is a headless Chrome cluster sidecar. It renders pages and returns raw HTML — TomoriBot then applies Readability extraction and Turndown to produce markdown locally. Use it as a fallback when Crawl4AI's extraction is too aggressive for a particular site.

*Note: Browserless v2 has SSPL/commercial license terms; review `servers/browserless/README.md` before using it in commercial deployments.*

**Docker Compose (Recommended):**
First, set `BROWSERLESS_BASE_URL=http://browserless:3000/` and `BROWSERLESS_TOKEN=your-random-token` in `.env`. 
Then, start with:
```sh
docker compose --profile fetch-browserless up -d
```

**Standalone Docker (for `bun run dev`):**
Set `BROWSERLESS_BASE_URL=http://localhost:3000/` and `BROWSERLESS_TOKEN=your-random-token` in `.env`.
Run the container:

**PowerShell:**
```powershell
docker run -d --name browserless -p 3000:3000 --shm-size=2g `
  -e TOKEN=your-random-token `
  ghcr.io/browserless/chromium:latest
```

**Bash (Linux/macOS):**
```bash
docker run -d --name browserless -p 3000:3000 --shm-size=2g \
  -e TOKEN=your-random-token \
  ghcr.io/browserless/chromium:latest
```

---

## 3. Starting Order (Important)

TomoriBot probes sidecar health on the **first `fetch_url` call after startup** and caches the result for 60 seconds. If a container isn't ready when that first probe fires, the bot treats it as unavailable for the next minute.

**Always start your sidecar containers before starting TomoriBot.**

### First-time setup

1. Start the container(s) and wait until they show `(healthy)` in `docker ps`:
   ```powershell
   docker ps
   ```
2. Set the corresponding env vars in `.env` (see sections 1 and 2 above).
3. Start TomoriBot (`bun run dev` or `docker compose up`).

### Returning after a restart

If the container already exists from a previous run, use `docker start` instead of `docker run` to avoid a naming conflict:

```powershell
# Start an existing container
docker start crawl4ai
docker start browserless

# Confirm healthy before starting TomoriBot
docker ps
```

Then start TomoriBot as normal. Restarting `bun run dev` resets the in-memory health cache, so as long as the container is ready first the correct engine will be picked up immediately.

---

## 4. Cookie Injection (Authenticated Fetches — Optional)

Both sidecars support injecting browser-level cookies so the headless browser appears already logged in when fetching a page. This is useful for sites that require a session to view content (e.g. paywalled news, private forums, login-gated dashboards).

The MCP fetch fallback does **not** support cookie injection — cookies only apply when a sidecar is active.

> **Limitation:** Cookie injection bypasses login walls but not bot fingerprinting. Sites with aggressive anti-bot detection (notably Twitter/X) detect headless Playwright via canvas/WebGL fingerprinting and serve empty pages even with valid session cookies. Cookie injection works well for sites that gate on authentication alone.

### Getting your cookies

1. Open your browser and log in to the target site.
2. Open DevTools (`F12`) → **Application** tab → **Storage** → **Cookies** → select the site's domain.
3. Copy the `Value` of each required cookie (typically a session token — check the site's cookie names).

### Crawl4AI

Set `CRAWL4AI_COOKIES_JSON` in `.env` as a JSON array:

```env
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

When this is set, `fetch_url` automatically switches from the `/md` endpoint to `/crawl` with `browser_config.cookies` — `/md` does not support cookie injection.

### Browserless

Set `BROWSERLESS_COOKIES_JSON` in `.env` using the same format:

```env
BROWSERLESS_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

Browserless passes cookies directly in the `/content` request body, so no endpoint switch is needed.

### Cookie object fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Cookie name |
| `value` | Yes | Cookie value |
| `domain` | No | Domain scope (e.g. `.x.com`). Recommended for correctness. |
| `path` | No | Path scope. Defaults to `/` if omitted. |

> **Note:** Cookie values are sensitive — treat them like passwords. They grant full session access to your account. Do not commit `.env` to version control.

---

## 5. No Browser Sidecar
Leave `CRAWL4AI_BASE_URL` and `BROWSERLESS_BASE_URL` unset. The `fetch_url` tool will cleanly fall back to the bundled `mcp_fetch` engine.