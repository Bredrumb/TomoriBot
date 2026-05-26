# 24. NovelAI Provider Limitations

This document catalogs every feature, tool, and context block that is deliberately disabled or reduced for the NovelAI provider compared to Google Gemini and OpenRouter. All exclusions fall into one of two root causes:

1. **Text-only model** — GLM 4.6 has no vision or image understanding capability.
2. **Token budget** — NovelAI's API has a hard token cap that creates a practical quality threshold around ~2800 tokens of system prompt. Exceeding it degrades output quality noticeably.

See also: [`tool-calling.md`](./tool-calling.md) for how prompt-based tool calling itself works.

---

## Built-in Tools Disabled

Some tools are disabled by provider-specific `isAvailableFor()` checks, while
vision-dependent tools are removed by the registry's first-pass capability
filter because NovelAI models have `sees_images = false`.

| Tool | File | Reason |
|------|------|--------|
| `select_sticker_for_response` | `src/tools/functionCalls/stickerTool.ts:144` | GLM 4.6 cannot reliably generate CJK/Japanese sticker names as tool arguments — token-level instability causes garbled output. |
| `update_short_term_memory` | `src/tools/functionCalls/updateShortTermMemoryTool.ts:56` | Token budget too constrained; the tool definition and invocation overhead is not worth the benefit at GLM's prompt size. |
| `peek_profile_picture` | `src/tools/functionCalls/peekProfilePictureTool.ts` | Requires `requiredModelCapabilities = { sees_images: true }`; NovelAI models are text-only. |
| `process_gif` | `src/tools/functionCalls/processGifTool.ts` | Requires `requiredModelCapabilities = { sees_images: true }`; NovelAI models are text-only. |

---

## MCP Functions Blocked

Even when MCP servers are running, the following function names are stripped from the tool list before it is passed to GLM. Controlled in `src/providers/novelai/novelaiToolAdapter.ts:301`.

```
felo-search
iask-search
monica-search
fetch-url
url-metadata
fetch
brave_news_search
```

**Reason:** These are either redundant with other search tools already available (e.g., `brave_web_search` covers general search), or they are too token-expensive in their argument schemas and response payloads for GLM's strict prompt budget.

---

## Context Blocks Excluded from System Prompt

Each provider's stream adapter defines which `ContextItemTag` blocks are included in the system instruction. NovelAI's list omits two tags that all other providers (Google, OpenRouter, Custom) include:

| Tag | Other providers | NovelAI |
|-----|----------------|---------|
| `KNOWLEDGE_SERVER_EMOJIS` | ✅ Included | ❌ Excluded |
| `KNOWLEDGE_SERVER_STICKERS` | ✅ Included | ❌ Excluded |

**Source:** `src/providers/novelai/novelaiStreamAdapter.ts:107-109`

```typescript
private static readonly SYSTEM_INSTRUCTION_TAGS_TOOLING: ContextItemTag[] = [
    ContextItemTag.SYSTEM_FUNCTION_GUIDE,
    // REMOVED: KNOWLEDGE_SERVER_EMOJIS, KNOWLEDGE_SERVER_STICKERS — GLM 4.6 is text-only
    // and cannot use emojis/stickers. Omitting saves significant tokens toward the ~2800
    // token quality threshold.
];
```

**Practical effect:** The model is never told which custom server emojis or stickers exist, so it will not reference or attempt to use them. The `emojiUsageEnabled` config flag still flows through to the stream adapter (it controls output formatting), but without the knowledge block, the model has no emoji list to draw from.

---

## Short-Term Memory Tool Instructions Suppressed

Even though the `update_short_term_memory` tool is excluded from the tool list for NovelAI (see above), there is a second independent suppression point in context building.

**Source:** `src/utils/text/contextBuilder.ts:519`

```typescript
const isStmToolAvailable = tomoriState.llm.llm_provider !== "novelai";
```

When `isStmToolAvailable` is `false`:
- The hint message `"[System: HINT: Use the update_short_term_memory tool...]"` is never injected after short-term memory summaries.
- The nudge prompt that encourages the model to call the tool when a conversation goes stale is also suppressed.

The short-term memory **data itself** (summaries and recent messages) is still included in context when available — only the tool-use instructions around it are removed.

---

## Provider Capability Flags

Declared in `src/providers/novelai/novelaiProvider.ts:129-141`:

```typescript
supportsImages: false,   // Text-only, no vision
supportsVideos: false,   // Text-only, no vision
supportsFunctionCalling: true, // Prompt-based only, GLM 4.6 models only
```

These flags gate image/video attachment processing earlier in the pipeline, so media is never forwarded to NovelAI even if a user sends it.

---

## Reminder Tool: Auto-Fill Quirk

**Source:** `src/tools/functionCalls/reminderTool.ts:255-266`

When the reminder tool is called via NovelAI and `repetition_interval_hours` is missing from the model's response (a common GLM omission for simple "remind me in X" requests), the tool automatically defaults the value to `0` (one-time reminder) instead of rejecting the call.

```typescript
// NovelAI only — other providers require the model to set this explicitly
if (context.provider === "novelai" && typeof repetitionIntervalHoursArg !== "number") {
    repetitionIntervalHoursArg = 0;
}
```

Other providers do **not** get this fallback — they must explicitly set the field so the model is "conscious" of whether the reminder is one-time or recurring.

---

## Summary Table

| Feature | Disabled for NovelAI? | Root Cause |
|---------|----------------------|------------|
| `select_sticker_for_response` tool | ✅ Yes | CJK name generation instability |
| `update_short_term_memory` tool | ✅ Yes | Token budget |
| `peek_profile_picture` tool | ✅ Yes | Text-only model |
| `process_gif` tool | ✅ Yes | Text-only model |
| MCP fetch functions (`fetch`, `fetch-url`, `url-metadata`) | ✅ Yes | Token budget / redundant |
| MCP alternative search engines | ✅ Yes | Token budget / redundant |
| `brave_news_search` MCP | ✅ Yes | Token budget |
| `KNOWLEDGE_SERVER_EMOJIS` context block | ✅ Yes | Text-only + token budget |
| `KNOWLEDGE_SERVER_STICKERS` context block | ✅ Yes | Text-only + token budget |
| STM tool hint injections | ✅ Yes | Token budget |
| Image attachment processing | ✅ Yes | Text-only model |
| Video attachment processing | ✅ Yes | Text-only model |
| `repetition_interval_hours` required | ❌ Relaxed | GLM omits it frequently (auto-fills 0) |

---

## Adding Future Exclusions

When adding a new tool that depends on model capabilities, declare them directly on the tool:

```typescript
requiredModelCapabilities = {
    sees_images: true,
};
```

When adding a new tool that should be disabled for NovelAI for provider-specific reasons
(token budget, GLM argument instability, etc.), override `isAvailableFor()` in the tool class:

```typescript
isAvailableFor(provider: string, _context: unknown): boolean {
    if (provider === "novelai") return false; // text-only / token budget
    return true;
}
```

When excluding a context block from NovelAI's system prompt, remove its `ContextItemTag` from the relevant static array in `src/providers/novelai/novelaiStreamAdapter.ts` and leave a comment explaining why.
