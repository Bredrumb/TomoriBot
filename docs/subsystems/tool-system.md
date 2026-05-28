---
title: "Tool System"
---

TomoriBot exposes built-in `BaseTool` classes through `src/tools/toolRegistry.ts` and MCP functions through provider adapters. Centralized availability logic lives in `src/tools/availability.ts`; it applies provider checks, model capability checks, feature flags, guild MCP collision rules, and deliberate-tool allowlists before tools are sent to the LLM.

## Unified Web Tools

`web_search` is the LLM-visible web search surface. Its dispatcher routes through internal engines and keeps engine-specific tool names hidden.

`fetch_url` is the LLM-visible URL-reading surface. Its dispatcher chain is configured by `FETCH_URL_ENGINE_ORDER`, currently supporting optional `crawl4ai` and `browserless` followed by mandatory `mcp_fetch` fallback. Unknown names are ignored, duplicates are collapsed, and `mcp_fetch` is always appended. `Crawl4aiEngine` is available only when `CRAWL4AI_BASE_URL` is set and `/health` is reachable. `BrowserlessEngine` is available only when `BROWSERLESS_BASE_URL` is set and `/pressure` is reachable; it calls `/content`, converts rendered HTML to markdown with Readability and Turndown, then applies the same pagination envelope. `McpFetchEngine` calls the bundled MCP `fetch` server internally through `FetchHandler.executeFetchInternal()`, so the old formatting, pagination, error envelopes, metadata, progress notice, and URL-size validation behavior are preserved while the raw global MCP `fetch` function is hidden from the LLM.

## Guild MCP Replacements

Guild MCP tools are appended after built-in and global MCP filtering, then collision-checked. If a guild enables a `url_fetcher` MCP server with at least one function, TomoriBot hides bundled `fetch_url` for that guild so the LLM receives one URL-fetch surface. Prompt macro resolution follows the same rule: `{url_fetch_tool}` prefers guild `url_fetcher` functions, then falls back to `fetch_url`.

## NovelAI

`fetch_url` is not exposed to NovelAI initially. NovelAI GLM tool calling is prompt-based and token-constrained, and fetched-page payloads need separate prompt-budget validation before enabling this tool.
