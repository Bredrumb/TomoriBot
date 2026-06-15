import { type ToolStateForContext, getAvailableToolsWithMCP } from "@/tools/toolRegistry";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { log } from "@/utils/misc/logger";

export interface ToolPromptMacroContext {
  provider?: string | null;
  stateForContext?: ToolStateForContext | null;
}

export interface ToolPromptMacroResolver {
  expand(text: string): Promise<string>;
}

interface ToolPromptMacroAvailability {
  availableToolNames: Set<string>;
  guildWebSearchToolNames: string[];
  guildUrlFetcherToolNames: string[];
}

export interface ToolPromptMacroDocEntry {
  macro: string;
  type: "static" | "dynamic";
  currentTarget: string;
  notes: string;
}

const STATIC_TOOL_PROMPT_MACROS: Record<string, string> = {
  "{capabilities_tool}": "review_capabilities",
  "{memory_tool}": "create_long_term_memory",
  "{memory_update_tool}": "update_long_term_memory",
  "{short_term_memory_tool}": "update_short_term_memory",
  "{task_tool}": "create_task",
  "{task_update_tool}": "update_task",
  "{cross_channel_tool}": "cross_channel_message",
  "{sticker_tool}": "select_sticker_for_response",
  "{manage_message_tool}": "manage_message",
  "{pin_tool}": "manage_message",
  "{message_interaction_tool}": "interact_with_recent_message",
  "{profile_picture_tool}": "peek_profile_picture",
  "{document_tool}": "read_file",
  "{message_metadata_tool}": "reveal_message_metadata",
  "{timestamp_refresh_tool}": "reveal_message_metadata",
  "{media_context_tool}": "increase_media_context",
  "{gif_tool}": "process_gif",
  "{youtube_tool}": "process_youtube_video",
  "{image_analysis_tool}": "analyze_image",
  "{image_generation_tool}": "generate_image",
  "{anime_image_generation_tool}": "generate_image_nai",
  "{voice_message_tool}": "generate_voice_message",
  "{block_user_tool}": "block_user",
  "{unblock_user_tool}": "unblock_user",
};

const DYNAMIC_TOOL_PROMPT_MACROS = {
  "{web_search_tool}": {
    currentTarget: "best available web search tool",
    fallbackText: "the currently available web search tool",
    resolve: (availability: ToolPromptMacroAvailability) => resolveWebSearchToolName(availability),
  },
  "{image_search_tool}": {
    currentTarget: "best available image search tool",
    fallbackText: "the currently available image-search or web-search tool",
    resolve: (availability: ToolPromptMacroAvailability) =>
      resolveGuildFamilyToolName(
        availability.guildWebSearchToolNames,
        [/image/],
        [/video/, /news/, /local/, /fetch/],
      ) || resolveWebSearchToolName(availability),
  },
  "{video_search_tool}": {
    currentTarget: "best available video search tool",
    fallbackText: "the currently available video-search or web-search tool",
    resolve: (availability: ToolPromptMacroAvailability) =>
      resolveGuildFamilyToolName(
        availability.guildWebSearchToolNames,
        [/video/],
        [/image/, /news/, /local/, /fetch/],
      ) || resolveWebSearchToolName(availability),
  },
  "{news_search_tool}": {
    currentTarget: "best available news search tool",
    fallbackText: "the currently available news-search or web-search tool",
    resolve: (availability: ToolPromptMacroAvailability) =>
      resolveGuildFamilyToolName(
        availability.guildWebSearchToolNames,
        [/news/],
        [/image/, /video/, /local/, /fetch/],
      ) || resolveWebSearchToolName(availability),
  },
  "{url_fetch_tool}": {
    currentTarget: "best available URL fetch tool",
    fallbackText: "the currently available URL fetch tool",
    resolve: (availability: ToolPromptMacroAvailability) =>
      resolveGuildFamilyToolName(
        availability.guildUrlFetcherToolNames,
        [/fetch/, /read/, /crawl/, /page/, /open/, /visit/, /url/],
        [/metadata/, /meta/, /head/],
      ) || pickFirstAvailable(availability.availableToolNames, ["fetch_url", "fetch"]),
  },
  "{url_metadata_tool}": {
    currentTarget: "best available URL metadata tool",
    fallbackText: "the currently available URL metadata or fetch tool",
    resolve: (availability: ToolPromptMacroAvailability) =>
      resolveGuildFamilyToolName(
        availability.guildUrlFetcherToolNames,
        [/metadata/, /meta/, /head/, /headers/, /preview/, /info/],
        [/fetch/, /read/, /crawl/],
      ) || pickFirstAvailable(availability.availableToolNames, ["url-metadata", "fetch_url", "fetch"]),
  },
} as const;

const STATIC_TOOL_PROMPT_MACRO_KEYS = Object.keys(STATIC_TOOL_PROMPT_MACROS);
const DYNAMIC_TOOL_PROMPT_MACRO_KEYS = Object.keys(DYNAMIC_TOOL_PROMPT_MACROS);
const ALL_TOOL_PROMPT_MACRO_KEYS = [...STATIC_TOOL_PROMPT_MACRO_KEYS, ...DYNAMIC_TOOL_PROMPT_MACRO_KEYS];

export const TOOL_PROMPT_MACRO_DOCS: ToolPromptMacroDocEntry[] = [
  {
    macro: "{capabilities_tool}",
    type: "static",
    currentTarget: "review_capabilities",
    notes: "Inspect current tools/settings before making assumptions.",
  },
  {
    macro: "{memory_tool}",
    type: "static",
    currentTarget: "create_long_term_memory",
    notes: "Store a new long-term memory.",
  },
  {
    macro: "{memory_update_tool}",
    type: "static",
    currentTarget: "update_long_term_memory",
    notes: "Update an existing long-term memory by ID, or delete it by sending blank content.",
  },
  {
    macro: "{short_term_memory_tool}",
    type: "static",
    currentTarget: "update_short_term_memory",
    notes: "Update the current conversation's short-term memory.",
  },
  {
    macro: "{task_tool}",
    type: "static",
    currentTarget: "create_task",
    notes: "Create reminders or scheduled self-tasks.",
  },
  {
    macro: "{task_update_tool}",
    type: "static",
    currentTarget: "update_task",
    notes: "Update an existing reminder/task by ID, or delete it by sending blank content.",
  },
  {
    macro: "{cross_channel_tool}",
    type: "static",
    currentTarget: "cross_channel_message",
    notes: "Send an immediate message to another channel or thread.",
  },
  {
    macro: "{create_thread_tool}",
    type: "static",
    currentTarget: "create_thread",
    notes: "Create a Discord thread and send its first message.",
  },
  {
    macro: "{sticker_tool}",
    type: "static",
    currentTarget: "select_sticker_for_response",
    notes: "Attach a Discord sticker to the response.",
  },
  {
    macro: "{manage_message_tool}",
    type: "static",
    currentTarget: "manage_message",
    notes:
      "Canonical macro for pinning any recent message or editing/deleting recent messages sent by you or another current character.",
  },
  {
    macro: "{pin_tool}",
    type: "static",
    currentTarget: "manage_message",
    notes: "Compatibility alias for `{manage_message_tool}`.",
  },
  {
    macro: "{message_interaction_tool}",
    type: "static",
    currentTarget: "interact_with_recent_message",
    notes: "React to or reply to a recent message for playful backtracking or commentary.",
  },
  {
    macro: "{profile_picture_tool}",
    type: "static",
    currentTarget: "peek_profile_picture",
    notes: "Inspect a user's avatar or banner.",
  },
  {
    macro: "{document_tool}",
    type: "static",
    currentTarget: "read_file",
    notes: "Read recent file attachments (PDF, source code, text, etc.).",
  },
  {
    macro: "{message_metadata_tool}",
    type: "static",
    currentTarget: "reveal_message_metadata",
    notes: "Canonical macro for annotating recent visible turns with refs and sent timestamps.",
  },
  {
    macro: "{timestamp_refresh_tool}",
    type: "static",
    currentTarget: "reveal_message_metadata",
    notes: "Compatibility alias for `{message_metadata_tool}`.",
  },
  {
    macro: "{media_context_tool}",
    type: "static",
    currentTarget: "increase_media_context",
    notes: "Bring older hidden images/videos back into context.",
  },
  {
    macro: "{gif_tool}",
    type: "static",
    currentTarget: "process_gif",
    notes: "Extract GIF frames for analysis.",
  },
  {
    macro: "{youtube_tool}",
    type: "static",
    currentTarget: "process_youtube_video",
    notes: "Analyze a YouTube video.",
  },
  {
    macro: "{image_analysis_tool}",
    type: "static",
    currentTarget: "analyze_image",
    notes: "Delegate image understanding to the vision model.",
  },
  {
    macro: "{image_generation_tool}",
    type: "static",
    currentTarget: "generate_image",
    notes: "Generate or edit images with the active provider.",
  },
  {
    macro: "{anime_image_generation_tool}",
    type: "static",
    currentTarget: "generate_image_nai",
    notes: "Generate anime-styled images with NovelAI.",
  },
  {
    macro: "{voice_message_tool}",
    type: "static",
    currentTarget: "generate_voice_message",
    notes: "Send a spoken voice-message response.",
  },
  {
    macro: "{block_user_tool}",
    type: "static",
    currentTarget: "block_user",
    notes: "Temporarily mute or block a Discord user for the active persona.",
  },
  {
    macro: "{unblock_user_tool}",
    type: "static",
    currentTarget: "unblock_user",
    notes: "Remove an active persona-scoped mute/block for a Discord user.",
  },
  {
    macro: "{web_search_tool}",
    type: "dynamic",
    currentTarget: "best available web search tool",
    notes: "Resolves to bundled Brave/DuckDuckGo search or a guild MCP web-search replacement when one is discovered.",
  },
  {
    macro: "{image_search_tool}",
    type: "dynamic",
    currentTarget: "best available image search tool",
    notes: "Prefers image-specific search, then falls back to the resolved web-search tool.",
  },
  {
    macro: "{video_search_tool}",
    type: "dynamic",
    currentTarget: "best available video search tool",
    notes: "Prefers video-specific search, then falls back to the resolved web-search tool.",
  },
  {
    macro: "{news_search_tool}",
    type: "dynamic",
    currentTarget: "best available news search tool",
    notes: "Prefers news-specific search, then falls back to the resolved web-search tool.",
  },
  {
    macro: "{url_fetch_tool}",
    type: "dynamic",
    currentTarget: "best available URL fetch tool",
    notes: "Resolves to bundled fetch or a guild MCP url_fetcher replacement when one is discovered.",
  },
  {
    macro: "{url_metadata_tool}",
    type: "dynamic",
    currentTarget: "best available URL metadata tool",
    notes: "Prefers metadata-specific fetcher functions, then falls back to a compatible URL fetch tool.",
  },
];

export function hasToolPromptMacros(text: string): boolean {
  return ALL_TOOL_PROMPT_MACRO_KEYS.some((macro) => text.includes(macro));
}

export function createToolPromptMacroResolver(context?: ToolPromptMacroContext | null): ToolPromptMacroResolver {
  let availabilityPromise: Promise<ToolPromptMacroAvailability> | null = null;

  return {
    async expand(text: string): Promise<string> {
      if (!text || !hasToolPromptMacros(text)) {
        return text;
      }

      let expanded = text;

      for (const [macro, toolName] of Object.entries(STATIC_TOOL_PROMPT_MACROS)) {
        if (expanded.includes(macro)) {
          expanded = expanded.replaceAll(macro, formatResolvedToolName(toolName));
        }
      }

      const presentDynamicMacros = DYNAMIC_TOOL_PROMPT_MACRO_KEYS.filter((macro) => expanded.includes(macro));
      if (presentDynamicMacros.length === 0) {
        return expanded;
      }

      availabilityPromise ??= loadToolPromptMacroAvailability(context);
      const availability = await availabilityPromise;

      for (const macro of presentDynamicMacros) {
        const definition = DYNAMIC_TOOL_PROMPT_MACROS[macro as keyof typeof DYNAMIC_TOOL_PROMPT_MACROS];
        const resolvedToolName = definition.resolve(availability);
        expanded = expanded.replaceAll(
          macro,
          resolvedToolName ? formatResolvedToolName(resolvedToolName) : definition.fallbackText,
        );
      }

      return expanded;
    },
  };
}

function formatResolvedToolName(toolName: string): string {
  return `\`${toolName}\``;
}

async function loadToolPromptMacroAvailability(
  context?: ToolPromptMacroContext | null,
): Promise<ToolPromptMacroAvailability> {
  const fallbackAvailability: ToolPromptMacroAvailability = {
    availableToolNames: new Set<string>(),
    guildWebSearchToolNames: [],
    guildUrlFetcherToolNames: [],
  };

  const provider = context?.provider?.trim().toLowerCase();
  const stateForContext = context?.stateForContext;
  if (!provider || !stateForContext?.server_id || !stateForContext.llm) {
    return fallbackAvailability;
  }

  try {
    const [{ builtInTools, mcpFunctionNames }, guildToolNames] = await Promise.all([
      getAvailableToolsWithMCP(provider, stateForContext),
      loadGuildToolFamilyNames(stateForContext.server_id),
    ]);
    // Names that are filtered globally in `availability.ts` but might still
    // appear in MCP listings — kept here as a defensive trim.
    const providerHiddenGlobalFunctions = new Set([
      "felo-search",
      "iask-search",
      "monica-search",
      "fetch",
      "fetch-url",
      "url-metadata",
    ]);
    const availableToolNames = new Set<string>();

    for (const tool of builtInTools) {
      availableToolNames.add(tool.name);
    }

    for (const functionName of mcpFunctionNames) {
      if (providerHiddenGlobalFunctions.has(functionName)) {
        continue;
      }
      availableToolNames.add(functionName);
    }

    return {
      availableToolNames,
      guildWebSearchToolNames: guildToolNames.webSearch,
      guildUrlFetcherToolNames: guildToolNames.urlFetcher,
    };
  } catch (error) {
    log.warn("[ToolPromptMacros] Failed to load tool availability for prompt macro expansion", error);
    return fallbackAvailability;
  }
}

async function loadGuildToolFamilyNames(serverId: string): Promise<{ webSearch: string[]; urlFetcher: string[] }> {
  const parsedServerId = Number.parseInt(serverId, 10);
  if (!Number.isFinite(parsedServerId)) {
    return { webSearch: [], urlFetcher: [] };
  }

  const guildMcpManager = getGuildMcpManager();
  const [webSearch, urlFetcher] = await Promise.all([
    guildMcpManager.getGuildMCPFunctionNamesByServerType(parsedServerId, "web_search"),
    guildMcpManager.getGuildMCPFunctionNamesByServerType(parsedServerId, "url_fetcher"),
  ]);

  return { webSearch, urlFetcher };
}

function resolveWebSearchToolName(availability: ToolPromptMacroAvailability): string | null {
  return (
    resolveGuildFamilyToolName(
      availability.guildWebSearchToolNames,
      [/web/, /search/],
      [/image/, /video/, /news/, /local/, /fetch/, /metadata/, /summar/, /preview/],
    ) || pickFirstAvailable(availability.availableToolNames, ["web_search"])
  );
}

function resolveGuildFamilyToolName(
  functionNames: string[],
  preferredPatterns: RegExp[],
  avoidPatterns: RegExp[] = [],
): string | null {
  const uniqueFunctionNames = Array.from(new Set(functionNames));
  if (uniqueFunctionNames.length === 0) {
    return null;
  }

  let bestName: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const name of uniqueFunctionNames) {
    const normalized = name.toLowerCase();
    let score = 0;

    for (const pattern of preferredPatterns) {
      if (pattern.test(normalized)) {
        score += 10;
      }
    }

    for (const pattern of avoidPatterns) {
      if (pattern.test(normalized)) {
        score -= 10;
      }
    }

    if (score > bestScore || (score === bestScore && bestName !== null && name.localeCompare(bestName) < 0)) {
      bestName = name;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestName : (uniqueFunctionNames[0] ?? null);
}

function pickFirstAvailable(availableToolNames: Set<string>, preferredToolNames: string[]): string | null {
  for (const toolName of preferredToolNames) {
    if (availableToolNames.has(toolName)) {
      return toolName;
    }
  }

  return null;
}
