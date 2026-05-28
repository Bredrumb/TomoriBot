# Browserless URL Fetch Sidecar

Browserless is an optional hidden engine behind TomoriBot's single
`fetch_url(url, max_length?, start_index?, raw?)` tool. It renders pages in a
real browser through Browserless `/content`, then TomoriBot converts the
rendered HTML to readable markdown with Readability and Turndown.

`fetch_url` engine chain by default:

```text
crawl4ai -> browserless -> mcp_fetch
```

The LLM still sees only `fetch_url`. Do not expose Browserless as a separate
tool.

## License Warning

Browserless v2 is not an Apache/MIT-style unrestricted dependency. The upstream
project is dual licensed under SSPL-1.0 or the Browserless Commercial License,
and Browserless says commercial proprietary or closed-source CI usage requires
a commercial license.

Before enabling this sidecar for a business, closed-source deployment, or CI
environment, review the current Browserless license terms:

- https://github.com/browserless/browserless
- https://docs.browserless.io/

## Docker Compose Profile

Start only Browserless:

```powershell
docker compose --profile fetch-browserless up -d browserless
```

Start both optional browser fetch sidecars:

```powershell
docker compose --profile fetch-crawl4ai --profile fetch-browserless up -d
```

For the app container, set:

```env
BROWSERLESS_BASE_URL=http://browserless:3000/
BROWSERLESS_TOKEN=tomoribot-browserless-dev-token
FETCH_URL_ENGINE_ORDER=crawl4ai,browserless,mcp_fetch
```

The compose service uses `BROWSERLESS_TOKEN` when set. If it is missing, the
compose file supplies a development token so local setup does not accidentally
start Browserless with a random token the app cannot know.

## Standalone Docker

Use this when running TomoriBot directly with `bun run dev` outside Compose.

PowerShell:

```powershell
$env:BROWSERLESS_TOKEN="replace-with-a-long-random-token"
docker run -d --name browserless -p 3000:3000 --shm-size=2g `
  -e "TOKEN=$env:BROWSERLESS_TOKEN" `
  -e "CONCURRENT=2" `
  -e "QUEUED=4" `
  -e "HEALTH=true" `
  -e "MAX_CPU_PERCENT=90" `
  -e "MAX_MEMORY_PERCENT=90" `
  ghcr.io/browserless/chromium@sha256:<DIGEST>

$env:BROWSERLESS_BASE_URL="http://localhost:3000/"
```

Linux/macOS:

```bash
export BROWSERLESS_TOKEN="replace-with-a-long-random-token"
docker run -d --name browserless -p 3000:3000 --shm-size=2g \
  -e "TOKEN=$BROWSERLESS_TOKEN" \
  -e "CONCURRENT=2" \
  -e "QUEUED=4" \
  -e "HEALTH=true" \
  -e "MAX_CPU_PERCENT=90" \
  -e "MAX_MEMORY_PERCENT=90" \
  ghcr.io/browserless/chromium@sha256:<DIGEST>

export BROWSERLESS_BASE_URL="http://localhost:3000/"
```

For quick local testing you can use `ghcr.io/browserless/chromium:latest`, but
production deployments should pin a digest.

## Image Pinning

Find the current digest:

```bash
docker pull ghcr.io/browserless/chromium:latest
docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/browserless/chromium:latest
```

Replace `ghcr.io/browserless/chromium:latest` with the returned
`ghcr.io/browserless/chromium@sha256:...` value in deployment files, then smoke
test with:

```bash
curl "http://localhost:3000/pressure?token=$BROWSERLESS_TOKEN"
curl -X POST "http://localhost:3000/content?token=$BROWSERLESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/"}'
```

## Robots.txt Behavior

TomoriBot does not add a Browserless-specific robots.txt gate in this phase.
Browserless renders the requested page in a browser session and follows the
target site's normal network behavior. Operators are responsible for using this
sidecar only on URLs they are allowed to fetch and for complying with each
site's terms, robots policy, and rate limits.

Run Browserless only on a private network. Do not expose port `3000` publicly
without authentication and network controls.

TomoriBot blocks localhost/private/internal target URLs before it calls
Browserless unless `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`. Keep the default
false unless the bot is in a trusted self-hosted deployment where users are
allowed to make `fetch_url` reach internal network addresses.

## Runtime Behavior

| Setting | Owner | Default |
|---|---|---|
| `BROWSERLESS_BASE_URL` | TomoriBot | unset |
| `BROWSERLESS_TOKEN` | TomoriBot and Browserless | unset |
| `FETCH_URL_ENGINE_ORDER` | TomoriBot | `crawl4ai,browserless,mcp_fetch` |
| `FETCH_URL_TIMEOUT_MS` | TomoriBot | `15000` |
| `FETCH_URL_HEALTHCHECK_CACHE_SEC` | TomoriBot | `60` |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | TomoriBot | `false` |

- If `BROWSERLESS_BASE_URL` is unset, the Browserless engine is skipped.
- If `/pressure` is unreachable or reports unavailable, TomoriBot falls back to
  the next configured engine.
- If `/content` fails for a URL, TomoriBot falls back to the next configured
  engine.
- `raw=true` converts the full rendered HTML body to markdown. Normal mode runs
  Readability first for cleaner article-style output.
