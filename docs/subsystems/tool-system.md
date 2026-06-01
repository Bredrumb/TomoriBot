---
title: "Tool System"
---

TomoriBot exposes built-in `BaseTool` classes through `src/tools/toolRegistry.ts` and MCP functions through provider adapters. Centralized availability logic lives in `src/tools/availability.ts`; it applies provider checks, model capability checks, feature flags, guild MCP collision rules, and deliberate-tool allowlists before tools are sent to the LLM.

## Dynamic Tool Assembly

After availability filtering and before provider adapter serialization, built-in tools pass through `src/tools/assembly.ts`. Most tools are returned unchanged. Capability-sensitive tools can implement `assembleForContext(context)` to return a per-turn variant with a narrower `description`, `parameters`, or enum set, or `null` to hide the tool when no concrete backend is available.

Current dynamic schema users:

- `web_search` exposes only categories supported by the active search backend: SearXNG gets all categories, Brave gets text/image/video/news, and DuckDuckGo/Felo MCP fallback gets text-only.
- `generate_image` exposes only the modes supported by the configured standard image backend: text-to-image, image-to-image/reference fields, and ComfyUI inpaint/outpaint controls are pruned independently. It also injects server default positive image tags as prompt guidance, and passes default negative tags only to backends with a real negative-prompt channel.
- `generate_voice_message` exposes script markup and optional `voice_instructions` based on the active speech endpoint and persona voice-design state.

Runtime validation remains required. Assembly prevents the LLM from seeing unsupported options, while execution-time checks still guard stale config, backend health changes, and manually crafted tool calls.

## Unified Web Tools

`web_search` is the LLM-visible web search surface. Its dispatcher routes through internal engines and keeps engine-specific tool names hidden. The assembled schema guarantees the category enum for the current turn, so the tool description should not use fail-first language such as "this category may be unavailable" for advertised enum values.

`fetch_url` is the LLM-visible URL-reading surface. It validates the requested target before dispatch and blocks localhost/private/internal/reserved URLs unless `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`; the localized failure message names the default `FETCH_URL_ALLOW_PRIVATE_NETWORK=false` setting so TomoriBot can explain why the fetch failed. Its dispatcher chain is configured by `FETCH_URL_ENGINE_ORDER`, currently supporting optional `crawl4ai` followed by mandatory `mcp_fetch` fallback. Unknown names are ignored, duplicates are collapsed, and `mcp_fetch` is always appended. `Crawl4aiEngine` is available only when `CRAWL4AI_BASE_URL` is set and `/health` is reachable. `McpFetchEngine` calls the bundled MCP `fetch` server internally through `FetchHandler.executeFetchInternal()`, so the old formatting, pagination, error envelopes, metadata, progress notice, and URL-size validation behavior are preserved while the raw global MCP `fetch` function is hidden from the LLM.

## Guild MCP Replacements

Guild MCP tools are appended after built-in and global MCP filtering, then collision-checked. If a guild enables a `url_fetcher` MCP server with at least one function, TomoriBot hides bundled `fetch_url` for that guild so the LLM receives one URL-fetch surface. Prompt macro resolution follows the same rule: `{url_fetch_tool}` prefers guild `url_fetcher` functions, then falls back to `fetch_url`.

## NovelAI

`fetch_url` is not exposed to NovelAI initially. NovelAI GLM tool calling is prompt-based and token-constrained, and fetched-page payloads need separate prompt-budget validation before enabling this tool.
