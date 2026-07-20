---
title: "Tool System"
---

TomoriBot exposes built-in `BaseTool` classes through `src/tools/toolRegistry.ts` and MCP functions through provider adapters. Centralized availability logic lives in `src/tools/availability.ts`; it applies provider checks, model capability checks, feature flags, guild MCP collision rules, and deliberate-tool allowlists before tools are sent to the LLM.

## Dynamic Tool Assembly

After availability filtering and before provider adapter serialization, built-in tools pass through `src/tools/assembly.ts`. Most tools are returned unchanged. Capability-sensitive tools can implement `assembleForContext(context)` to return a per-turn variant with a narrower `description`, `parameters`, or enum set, or `null` to hide the tool when no concrete backend is available.

Current dynamic schema users:

- `web_search` exposes only categories supported by the active search backend: SearXNG gets all categories, Brave gets text/image/video/news, and DuckDuckGo/Felo MCP fallback gets text-only.
- `generate_image` exposes only the modes supported by the configured standard image backend: text-to-image, image-to-image/reference fields, and ComfyUI inpaint/outpaint controls are pruned independently. The descriptions of the parameters that survive pruning are also trimmed to the supported modes — `prompt` only appends inpaint/outpaint guidance when those modes exist, and `media_id`/`denoise` only name the reference modes (img2img/inpaint/outpaint) the backend can actually run — so a text-to-image-only backend never sees dead-weight edit-mode instructions. It injects server default positive image tags as prompt guidance, and passes default negative tags only when the custom image endpoint declares `workflow_supports.negative_prompt` support. ComfyUI image endpoints default that checkbox on; generic custom image endpoints default it off.
- `generate_voice_message` exposes script markup and optional `voice_instructions` based on the active speech endpoint and persona voice-design state.

Runtime validation remains required. Assembly prevents the LLM from seeing unsupported options, while execution-time checks still guard stale config, backend health changes, and manually crafted tool calls.

Image generation progress notices are also backend-aware. They only announce default negative tags when a negative-prompt channel is active, always include the image-tags setup hint, list saved user/persona image tags detected in the current context, and call out avatar references separately from message image references.

## Persona User Blocking

`block_user` and `unblock_user` are built-in Discord tools gated by `user_blocking_enabled` in `/capabilities manage`. They write to `persona_user_blocks`, scoped to the active persona rather than the whole server.

`mute` blocks only trigger eligibility for that persona. `block` replaces the target user's recent live dialogue-history turns and direct media during context building with a single `[System: ... sent a message but is currently blocked by you for N more hour(s). Use \`unblock_user\` to unblock if needed]` notice (consecutive messages from the same blocked user collapse into one notice), and suppresses reply annotations that would quote those messages. The notice is an LLM-facing system injection (English, not localized), mirroring reminder/join injections. `block` does not remove memories, reminders, documents, short-term memory summaries, or generic references from other users.

## Unified Web Tools

`web_search` is the LLM-visible web search surface. Its dispatcher routes through internal engines and keeps engine-specific tool names hidden. The assembled schema guarantees the category enum for the current turn, so the tool description should not use fail-first language such as "this category may be unavailable" for advertised enum values.

`fetch_url` is the LLM-visible URL-reading surface. It validates the requested target before dispatch and blocks localhost/private/internal/reserved URLs unless `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`; the localized failure message names the default `FETCH_URL_ALLOW_PRIVATE_NETWORK=false` setting so TomoriBot can explain why the fetch failed. The mandatory `safe_http` engine performs DNS validation and pinning, manually follows a bounded number of redirects, revalidates every hop, and limits the downloaded byte count before converting HTML to Markdown. The legacy `mcp_fetch` engine name is accepted as an alias for `safe_http`, but network fetching is no longer delegated to the Python MCP process. Crawl4AI may be listed in `FETCH_URL_ENGINE_ORDER` only for a trusted development deployment that also explicitly sets `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`; it is never part of the secure default chain.

## Guild MCP Replacements

Guild MCP tools are appended after built-in and global MCP filtering, then collision-checked. If a guild enables a `url_fetcher` MCP server with at least one function, TomoriBot hides bundled `fetch_url` for that guild so the LLM receives one URL-fetch surface. Prompt macro resolution follows the same rule: `{url_fetch_tool}` prefers guild `url_fetcher` functions, then falls back to `fetch_url`.

## NovelAI

`fetch_url` is not exposed to NovelAI initially. NovelAI GLM tool calling is prompt-based and token-constrained, and fetched-page payloads need separate prompt-budget validation before enabling this tool.
