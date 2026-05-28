# Setup: URL Fetch Sidecars (Crawl4AI & Browserless)

The `fetch_url` tool can optionally try browser-rendering sidecars before falling back to the bundled MCP fetch engine. Use them when you want rendered content for JS-heavy pages.

Default engine order is `crawl4ai,browserless,mcp_fetch`. 

---

## 1. Crawl4AI Sidecar
Crawl4AI is a browser-rendered markdown sidecar.

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
Browserless is a browser-rendered HTML sidecar.
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

## 3. Cookie Injection (Authenticated Fetches)

Both sidecars support injecting browser-level cookies so the headless browser appears already logged in when fetching a page. This is needed for sites like Twitter/X that return a login wall to unauthenticated visitors.

The MCP fetch fallback does **not** support cookie injection — cookies only apply when a sidecar is active.

### Getting your cookies

1. Open your browser and log in to the target site (e.g. `x.com`).
2. Open DevTools (`F12`) → **Application** tab → **Storage** → **Cookies** → select the site's domain.
3. Copy the `Value` of each required cookie.

**Twitter/X requires two cookies:**

| Cookie name | Where to find it |
|---|---|
| `auth_token` | Cookies for `https://x.com` |
| `ct0` | Cookies for `https://x.com` (CSRF token) |

### Crawl4AI

Set `CRAWL4AI_COOKIES_JSON` in `.env` as a JSON array:

```env
CRAWL4AI_COOKIES_JSON=[{"name":"auth_token","value":"YOUR_AUTH_TOKEN","domain":".x.com"},{"name":"ct0","value":"YOUR_CT0","domain":".x.com"}]
```

When this is set, `fetch_url` automatically switches from the `/md` endpoint to `/crawl` with `browser_config.cookies` — `/md` does not support cookie injection.

### Browserless

Set `BROWSERLESS_COOKIES_JSON` in `.env` using the same format:

```env
BROWSERLESS_COOKIES_JSON=[{"name":"auth_token","value":"YOUR_AUTH_TOKEN","domain":".x.com"},{"name":"ct0","value":"YOUR_CT0","domain":".x.com"}]
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

## 4. No Browser Sidecar
Leave `CRAWL4AI_BASE_URL` and `BROWSERLESS_BASE_URL` unset. The `fetch_url` tool will cleanly fall back to the bundled `mcp_fetch` engine.