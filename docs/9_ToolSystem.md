# 9. Tool System

This document explains TomoriBot's sophisticated tool system that enables AI function calling.

## Overview

TomoriBot has a **3-tier tool system**:
1. **Built-in Function Calls** - Native TypeScript tools
2. **MCP Servers** - Model Context Protocol external tools
3. **REST APIs** - Direct API integrations

All tools are managed by a centralized **ToolRegistry**.

## Architecture

```
┌─────────────────────────────────────────┐
│         ToolRegistry (Singleton)        │
│  - Registers all tools                  │
│  - Filters by feature flags             │
│  - Executes tool calls                  │
│  - Tracks execution history             │
└──────────┬──────────────┬───────────────┘
           │              │
    ┌──────▼──────┐ ┌────▼──────────┐
    │  Built-in   │ │      MCP      │
    │   Tools     │ │    Servers    │
    └─────────────┘ └───────────────┘
```

**Location:** `src/tools/toolRegistry.ts`

## Built-In Function Calls

### Location: `src/tools/functionCalls/`

### Available Tools

1. **Memory Tool** (`memoryTool.ts`)
   - **Purpose:** Create server/personal memories during conversation
   - **Function:** `create_server_memory`, `create_personal_memory`
   - **Example:** User says "remember that I like cats" → AI calls tool to save memory

2. **Reminder Tool** (`reminderTool.ts`)
   - **Purpose:** Set reminders for users
   - **Function:** `set_reminder`
   - **Example:** "remind me in 2 hours to check email" → Creates reminder

3. **Sticker Tool** (`stickerTool.ts`)
   - **Purpose:** Send Discord stickers
   - **Function:** `send_sticker`
   - **Example:** AI feels happy → Sends happy sticker

4. **Emoji Tool** (part of `stickerTool.ts`)
   - **Purpose:** React with emojis
   - **Function:** `react_with_emoji`
   - **Example:** AI finds something funny → Reacts with laughing emoji

5. **YouTube Video Tool** (`youTubeVideoTool.ts`)
   - **Purpose:** Extract video info from URLs
   - **Function:** `get_youtube_video_info`
   - **Example:** User shares YouTube link → AI describes video

6. **Pin Message Tool** (`pinMessageTool.ts`)
   - **Purpose:** Pin important messages
   - **Function:** `pin_message`
   - **Example:** Important announcement → AI pins it

7. **Peek Profile Picture Tool** (`peekProfilePictureTool.ts`)
   - **Purpose:** View user's profile picture
   - **Function:** `peek_profile_picture`
   - **Example:** "show me their avatar" → AI retrieves profile pic

8. **Review Capabilities Tool** (`reviewCapabilities.ts`)
   - **Purpose:** Let AI know what tools it has
   - **Function:** `review_my_current_capabilities`
   - **Example:** "what can you do?" → AI checks available tools

9. **Generate Image Tool** (`generateImageTool.ts`)
   - **Purpose:** Generate images using AI diffusion models
   - **Functions:** `generate_image`, `generate_image_from_image`
   - **Example:** "create an image of a sunset over mountains" → Generates image via Gemini Imagen
   - **Supports:** Text-to-image and image-to-image generation
   - **Requires:** `imagegen_enabled` feature flag

10. **Increase Media Context Tool** (`increaseMediaContextTool.ts`)
    - **Purpose:** Expand the media context window to view older images/videos
    - **Function:** `increase_media_context_window`
    - **Example:** User asks about an image from 10 messages ago → Expands context to include it
    - **Use Case:** When the AI needs to see media from earlier in the conversation

11. **Process GIF Tool** (`processGifTool.ts`)
    - **Purpose:** Extract keyframes from GIFs for analysis (development only)
    - **Function:** `process_gif`
    - **Example:** User uploads GIF → AI can analyze specific frames
    - **Note:** Development feature, may not be enabled in production

### Tool Definition Structure

```typescript
import { registerTool } from "../toolRegistry";
import type { Tool, ToolContext, ToolResult } from "../../types/tool/interfaces";

const myTool: Tool = {
  name: "my_tool_function",
  description: "What this tool does",
  category: "utility",

  parameters: {
    type: "object",
    properties: {
      arg1: {
        type: "string",
        description: "Description of argument",
      },
      arg2: {
        type: "number",
        description: "Another argument",
      }
    },
    required: ["arg1"],
  },

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    try {
      const arg1 = args.arg1 as string;
      const arg2 = args.arg2 as number | undefined;

      // Tool logic here
      const result = await doSomething(arg1, arg2);

      return {
        success: true,
        result: "Tool executed successfully",
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  },

  isAvailableFor(provider: string): boolean {
    // Return true if this tool works with this provider
    return ["google", "novelai"].includes(provider);
  },

  requiresFeatureFlag: "self_teaching_enabled", // Optional
  requiresPermissions: ["SEND_MESSAGES"], // Optional
};

// Register on module load
registerTool(myTool);
```

### Tool Context

Tools receive rich context:

```typescript
interface ToolContext {
  // Discord context
  client: Client;
  channel: TextChannel | DMChannel;
  userId: string;
  messageId?: string;

  // Bot state
  tomoriState: TomoriState;

  // Provider info
  provider: string; // "google", "novelai"

  // Streaming context (if applicable)
  streamContext?: StreamContext;
}
```

## MCP Servers

### What is MCP?

**Model Context Protocol** - A standardized way for AI models to use external tools.

**Spec:** https://modelcontextprotocol.io/

### Location: `src/tools/mcpServers/`

### Available MCP Servers

1. **Brave Search** (`brave-search/`)
   - **Function:** `brave_search`
   - **Purpose:** Web search using Brave Search API
   - **Requires:** Brave API key (optional, per-server)

2. **DuckDuckGo Search** (`duckduckgo-search/`)
   - **Functions:** `web-search`, `felo-search`, `fetch-url`, `url-metadata`
   - **Purpose:** Free web search (fallback when Brave unavailable)
   - **Requires:** No API key needed

3. **Fetch** (`fetch/`)
   - **Function:** `fetch_url`
   - **Purpose:** Fetch raw webpage content
   - **Requires:** No API key needed

### MCP Server Registration

**File:** `src/events/clientReady/02_registerMCPs.ts`

```typescript
import { getMCPManager } from "../../utils/mcp/mcpManager";

// Brave Search MCP
const braveSearchHandler = new BraveSearchMCPHandler();
await mcpManager.registerMCPServer("brave-search", braveSearchHandler);

// DuckDuckGo Search MCP
const duckduckgoHandler = new DuckDuckGoMCPHandler();
await mcpManager.registerMCPServer("duckduckgo-search", duckduckgoHandler);

// Fetch MCP
const fetchHandler = new FetchMCPHandler();
await mcpManager.registerMCPServer("fetch", fetchHandler);
```

### MCP Execution Flow

```
1. AI wants to search: "brave_search(query='weather in Tokyo')"
   ↓
2. ToolRegistry.executeTool("brave_search", args, context)
   ↓
3. ToolRegistry checks: Is this an MCP function?
   ↓
4. Yes → Forwards to MCP adapter
   ↓
5. MCP adapter calls MCP server
   ↓
6. MCP server returns search results
   ↓
7. Results sent back to AI
```

## REST API Tools

**Location:** `src/tools/restAPIs/`

TomoriBot also supports direct REST API integrations as an alternative to MCP servers. These provide HTTP-based tool implementations.

### Available REST API Tools

#### Brave Search REST API

**Location:** `src/tools/restAPIs/brave/`

**Purpose:** Direct HTTP integration with Brave Search API as an alternative to the MCP server approach.

**Files:**
- `braveSearchService.ts` - HTTP client for Brave Search API
- `braveTools.ts` - Tool interface implementation (extends `BaseTool`)
- `toolImplementations.ts` - Specific tool function implementations

**Advantages over MCP:**
- **Simpler deployment:** No external process management
- **Lower latency:** Direct HTTP calls without IPC overhead
- **Easier debugging:** Standard HTTP request/response logging
- **Better error handling:** Direct access to HTTP status codes and errors

**Disadvantages:**
- **Less standardized:** Provider-specific implementation
- **More coupling:** Tied to Brave's API structure
- **No tool sharing:** Can't reuse with other applications (MCP is cross-app)

### REST API vs MCP Comparison

| Feature | REST API Tools | MCP Servers |
|---------|---------------|-------------|
| **Setup Complexity** | Simple (just HTTP client) | Complex (subprocess management) |
| **Performance** | Lower latency (direct calls) | Higher latency (IPC overhead) |
| **Standardization** | Provider-specific | Standardized protocol |
| **Cross-app Reuse** | No | Yes (MCP is universal) |
| **Error Handling** | Direct HTTP errors | Process + protocol errors |
| **Best For** | Single-service integrations | Multi-service tool suites |

### When to Use REST API Tools

Use REST API tools instead of MCP when:
- You're integrating with a single service
- You need the lowest possible latency
- You want simpler deployment (no subprocess management)
- The service doesn't have an MCP server

Use MCP servers when:
- You want to share tools across multiple AI applications
- The service already has an MCP server available
- You need standardized tool discovery and schemas
- You're building a complex tool suite

## Feature Flags

Tools can be enabled/disabled per server via config flags.

### Feature Flag Mapping

**File:** `src/utils/tools/featureFlagMapper.ts`

```typescript
export function configToFeatureFlags(config: TomoriConfig) {
  return {
    // Built-in tools
    "self_teaching_enabled": config.self_teaching_enabled,
    "sticker_usage_enabled": config.sticker_usage_enabled,
    "emoji_usage_enabled": config.emoji_usage_enabled,
    "web_search_enabled": config.web_search_enabled,
    "pin_message_enabled": config.pin_message_enabled,
    "imagegen_enabled": config.imagegen_enabled,
    "videogen_enabled": config.videogen_enabled,

    // MCP functions
    "brave_search": config.web_search_enabled,
    "web-search": config.web_search_enabled, // DuckDuckGo
    "felo-search": config.web_search_enabled,
  };
}
```

### Enabling/Disabling Tools

```
/config permissions
```

Shows interactive menu to toggle:
- Self-teaching (memory creation)
- Sticker usage
- Emoji usage
- Web search
- Message pinning
- Image generation
- Video generation (future feature)

## Tool Registry API

### Register a Tool

```typescript
import { registerTool } from "./toolRegistry";

registerTool(myToolDefinition);
```

### Get Available Tools

```typescript
import { getAvailableTools } from "./toolRegistry";

const tools = getAvailableTools("google", context);
// Returns only tools that:
// - Support "google" provider
// - Have required feature flags enabled
// - Have required permissions
```

### Execute a Tool

```typescript
import { executeTool } from "./toolRegistry";

const result = await executeTool("set_reminder", {
  purpose: "Check email",
  delay_minutes: 120,
}, context);

if (result.success) {
  console.log("Reminder set!");
} else {
  console.error("Failed:", result.error);
}
```

### Get Tool Statistics

```typescript
const stats = ToolRegistry.getStats();
// {
//   totalTools: 12,
//   toolsByCategory: { memory: 2, expression: 2, utility: 3, ... },
//   recentExecutions: 45,
//   totalExecutions: 234
// }
```

## Creating a New Tool

### Step 1: Create Tool File

```bash
touch src/tools/functionCalls/translationTool.ts
```

### Step 2: Define Tool

```typescript
import { registerTool } from "../toolRegistry";
import type { Tool, ToolContext, ToolResult } from "../../types/tool/interfaces";

const translationTool: Tool = {
  name: "translate_text",
  description: "Translate text to another language",
  category: "utility",

  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Text to translate",
      },
      target_language: {
        type: "string",
        description: "Target language code (e.g., 'ja', 'es', 'fr')",
      }
    },
    required: ["text", "target_language"],
  },

  async execute(args, context) {
    const text = args.text as string;
    const targetLang = args.target_language as string;

    try {
      // Use translation API
      const translated = await translateAPI(text, targetLang);

      return {
        success: true,
        result: `Translated to ${targetLang}: ${translated}`,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  },

  isAvailableFor(provider) {
    return true; // Available for all providers
  },
};

registerTool(translationTool);
```

### Step 3: Test

Restart bot and trigger AI to use the tool:

```
User: "Translate 'hello world' to Japanese"
AI: *calls translate_text(text='hello world', target_language='ja')*
Tool: "Translated to ja: こんにちは世界"
AI: "The translation is: こんにちは世界"
```

## Tool Execution History

ToolRegistry tracks all executions:

```typescript
const history = ToolRegistry.getExecutionHistory(10);
// [
//   {
//     toolName: "set_reminder",
//     provider: "google",
//     serverId: "123",
//     userId: "456",
//     parameters: { purpose: "Check email", delay_minutes: 120 },
//     result: { success: true },
//     executionTime: 145, // ms
//     timestamp: Date
//   },
//   ...
// ]
```

## Provider Preference Logic

When multiple tools provide similar functionality:

**Example:** Brave Search (requires key) vs DuckDuckGo (free)

```typescript
// If server has Brave API key, prefer Brave over DuckDuckGo
if (hasBraveApiKey) {
  excludeTools(["web-search", "felo-search"]); // DuckDuckGo functions
}
```

**Location:** `src/tools/toolRegistry.ts:245`

## Error Handling

Tools should return structured results:

```typescript
// Success
return {
  success: true,
  result: "Operation completed successfully",
};

// Failure
return {
  success: false,
  error: "Failed because XYZ",
};
```

AI receives the error message and can:
- Retry with different parameters
- Inform the user
- Try alternative approach

## Tool Categories

| Category | Purpose | Examples |
|----------|---------|----------|
| **memory** | Data persistence | create_server_memory, create_personal_memory |
| **expression** | Emotional output | send_sticker, react_with_emoji |
| **utility** | General helpers | set_reminder, pin_message |
| **information** | Data retrieval | get_youtube_video_info, peek_profile_picture |
| **search** | Web search | brave_search, web-search, felo-search |
| **generation** | Content creation | generate_image, generate_image_from_image |
| **media** | Media processing | increase_media_context_window, process_gif |
| **meta** | Self-awareness | review_my_current_capabilities |

## Next Steps

Read document 10 (Streaming & Response System) to see how tool calls integrate with AI responses!
