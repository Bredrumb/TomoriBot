import { type ToolStateForContext, getAvailableToolsWithMCP } from "@/tools/toolRegistry";
import { expandDeliberateToolAllowedNames, isToolAllowedByDeliberateMode } from "@/utils/tools/deliberateToolMode";
import { applyToolActionAvailability, getActionSelector, getAvailableToolSelectors } from "@/utils/tools/toolActions";
import type { StreamingContext } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import type { AssembledServerConfig, TomoriState } from "@/types/db/schema";
import { renderPromptConditionals, type PromptConditionPredicate } from "./promptConditionals";

const PROMPT_CAPABILITY_NAMES = [
  "tool_use",
  "self_teaching",
  "personal_memories",
  "emoji_usage",
  "sticker_usage",
  "web_search",
  "manage_message",
  "thread_creation",
  "image_generation",
  "video_generation",
  "voice_message",
  "user_blocking",
  "short_term_memory",
  "time_awareness",
] as const;

type PromptCapabilityName = (typeof PROMPT_CAPABILITY_NAMES)[number];
export type PromptCapabilityValues = Partial<Record<PromptCapabilityName, boolean>>;

export interface ToolPromptMacroContext {
  provider?: string | null;
  stateForContext?: ToolStateForContext | null;
  capabilities?: PromptCapabilityValues | null;
  deliberateToolAllowedNames?: readonly string[] | null;
  streamContext?: StreamingContext;
}

export interface ToolPromptMacroResolver {
  expand(text: string): Promise<string>;
}

interface ToolPromptMacroAvailability {
  availableToolNames: Set<string>;
  guildWebSearchToolNames: string[];
  guildUrlFetcherToolNames: string[];
}

const STATIC_TOOL_PROMPT_MACROS: Record<string, string> = {
  "{capabilities_tool}": "review_capabilities",
  "{memory_tool}": "create_long_term_memory",
  "{memory_update_tool}": "update_long_term_memory",
  "{task_tool}": "create_task",
  "{task_update_tool}": "update_task",
  "{cross_channel_tool}": "cross_channel_message",
  "{create_thread_tool}": "create_thread",
  "{sticker_tool}": "select_sticker_for_response",
  "{manage_message_tool}": "manage_message",
  "{pin_tool}": "manage_message",
  "{message_interaction_tool}": "interact_with_recent_message",
  "{conditioning_interaction_tool}": "interact_with_target",
  "{profile_picture_tool}": "peek_profile_picture",
  "{document_tool}": "read_file",
  "{message_metadata_tool}": "reveal_message_metadata",
  "{timestamp_refresh_tool}": "reveal_message_metadata",
  "{gif_tool}": "process_gif",
  "{youtube_tool}": "process_youtube_video",
  "{image_analysis_tool}": "analyze_image",
  "{image_generation_tool}": "generate_image",
  "{anime_image_generation_tool}": "generate_image_nai",
  "{tag_search_tool}": "danbooru_search_tags",
  "{booru_post_search_tool}": "danbooru_search_posts",
  "{voice_message_tool}": "generate_voice_message",
  "{block_user_tool}": "block_user",
  "{unblock_user_tool}": "unblock_user",
  "{user_info_tool}": "update_user_info",
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
    resolve: (availability: ToolPromptMacroAvailability) => resolveUrlFetchToolName(availability),
  },
  "{url_metadata_tool}": {
    currentTarget: "best available URL metadata tool",
    fallbackText: "the currently available URL metadata or fetch tool",
    resolve: (availability: ToolPromptMacroAvailability) =>
      resolveGuildFamilyToolName(
        availability.guildUrlFetcherToolNames,
        [/metadata/, /meta/, /head/, /headers/, /preview/, /info/],
        [/fetch/, /read/, /crawl/],
      ) || pickFirstAvailable(availability.availableToolNames, ["fetch_url"]),
  },
} as const;

const STATIC_TOOL_PROMPT_MACRO_KEYS = Object.keys(STATIC_TOOL_PROMPT_MACROS);
const DYNAMIC_TOOL_PROMPT_MACRO_KEYS = Object.keys(DYNAMIC_TOOL_PROMPT_MACROS);

// Names no tool, because a model shown a tool it cannot call tends to write the call out as chat text.
export const UNAVAILABLE_TOOL_TEXT = "an unavailable tool";

// The hasTools flag must be the active model's narrowed value because it carries the Deliberate Tool Mode kill switch
// unlike tool_use_enabled.
export function resolvePromptCapabilityValues(
  config: AssembledServerConfig,
  hasTools: boolean,
): PromptCapabilityValues {
  return {
    tool_use: hasTools && (config.tool_use_enabled ?? true),
    self_teaching: config.self_teaching_enabled,
    personal_memories: config.personal_memories_enabled,
    emoji_usage: config.emoji_usage_enabled,
    sticker_usage: config.sticker_usage_enabled,
    web_search: config.web_search_enabled,
    manage_message: config.manage_message_enabled,
    thread_creation: config.thread_creation_enabled,
    image_generation: config.imagegen_enabled,
    video_generation: config.videogen_enabled,
    voice_message: config.voice_message_enabled,
    user_blocking: config.user_blocking_enabled,
    short_term_memory: config.short_term_memory_enabled,
    time_awareness: config.time_awareness_enabled,
  };
}

export function createToolPromptMacroResolver(context?: ToolPromptMacroContext | null): ToolPromptMacroResolver {
  let availabilityPromise: Promise<ToolPromptMacroAvailability> | null = null;
  const warnedConditions = new Set<string>();

  const warnOnce = (message: string): void => {
    if (warnedConditions.has(message)) return;
    warnedConditions.add(message);
    log.warn(`[PromptConditionals] ${message}`);
  };

  const evaluateCondition = async (predicate: PromptConditionPredicate): Promise<boolean | undefined> => {
    if (predicate.namespace === "capability") {
      if (!PROMPT_CAPABILITY_NAMES.includes(predicate.name as PromptCapabilityName)) {
        return undefined;
      }
      return context?.capabilities?.[predicate.name as PromptCapabilityName];
    }

    availabilityPromise ??= loadToolPromptMacroAvailability(context);
    const availability = await availabilityPromise;
    if (predicate.namespace === "tool") {
      return availability.availableToolNames.has(predicate.name);
    }

    if (predicate.name === "url_fetch") {
      return resolveUrlFetchToolName(availability) !== null;
    }

    return undefined;
  };

  return {
    async expand(text: string): Promise<string> {
      if (!text) {
        return text;
      }

      let expanded = await renderPromptConditionals(text, {
        evaluate: evaluateCondition,
        warn: warnOnce,
      });

      const presentStaticMacros = STATIC_TOOL_PROMPT_MACRO_KEYS.filter((macro) => expanded.includes(macro));
      const presentDynamicMacros = DYNAMIC_TOOL_PROMPT_MACRO_KEYS.filter((macro) => expanded.includes(macro));
      if (presentStaticMacros.length === 0 && presentDynamicMacros.length === 0) {
        return expanded;
      }

      availabilityPromise ??= loadToolPromptMacroAvailability(context);
      const availability = await availabilityPromise;

      for (const macro of presentStaticMacros) {
        const toolName = STATIC_TOOL_PROMPT_MACROS[macro];
        expanded = expanded.replaceAll(
          macro,
          availability.availableToolNames.has(toolName) ? formatStaticToolMacro(toolName) : UNAVAILABLE_TOOL_TEXT,
        );
      }

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

function formatStaticToolMacro(selector: string): string {
  const group = getActionSelector(selector);
  if (!group) return formatResolvedToolName(selector);
  const name = formatResolvedToolName(group.name);
  if (group.name === "manage_message") return name;
  const actions = selector === "update_long_term_memory" ? ["update"] : group.actions;
  return `${name} with action ${actions.map(formatResolvedToolName).join(" or ")}`;
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
  if (
    context?.capabilities?.tool_use === false ||
    !provider ||
    !stateForContext?.server_id ||
    !stateForContext.llm ||
    !stateForContext.llm.has_tools
  ) {
    return fallbackAvailability;
  }

  try {
    const {
      builtInTools,
      mcpFunctionNames,
      mcpToolFamilies = {},
    } = await getAvailableToolsWithMCP(provider, stateForContext);
    const guildToolNames = {
      webSearch: mcpFunctionNames.filter((name) => mcpToolFamilies[name] === "web_search"),
      urlFetcher: mcpFunctionNames.filter((name) => mcpToolFamilies[name] === "url_fetcher"),
    };
    const deliberateToolAllowedNames = expandDeliberateToolAllowedNames(
      context?.deliberateToolAllowedNames,
      mcpToolFamilies,
    );
    const filteredAvailableToolNames = new Set(
      mcpFunctionNames.filter((name) => !deliberateToolAllowedNames || deliberateToolAllowedNames.includes(name)),
    );
    for (const tool of builtInTools) {
      if (deliberateToolAllowedNames && !isToolAllowedByDeliberateMode(tool.name, deliberateToolAllowedNames)) continue;
      if (deliberateToolAllowedNames?.length === 0) continue;
      const variant = applyToolActionAvailability(tool, stateForContext.config, {
        ...context?.streamContext,
        deliberateToolAllowedNames,
      });
      if (variant) {
        for (const name of getAvailableToolSelectors(variant)) filteredAvailableToolNames.add(name);
      }
    }

    return {
      availableToolNames: filteredAvailableToolNames,
      guildWebSearchToolNames: guildToolNames.webSearch.filter((name) => filteredAvailableToolNames.has(name)),
      guildUrlFetcherToolNames: guildToolNames.urlFetcher.filter((name) => filteredAvailableToolNames.has(name)),
    };
  } catch (error) {
    log.warn("[ToolPromptMacros] Failed to load tool availability for prompt macro expansion", error);
    return fallbackAvailability;
  }
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

function resolveUrlFetchToolName(availability: ToolPromptMacroAvailability): string | null {
  return (
    resolveGuildFamilyToolName(
      availability.guildUrlFetcherToolNames,
      [/fetch/, /read/, /crawl/, /page/, /open/, /visit/, /url/],
      [/metadata/, /meta/, /head/],
    ) || pickFirstAvailable(availability.availableToolNames, ["fetch_url"])
  );
}

function pickFirstAvailable(availableToolNames: Set<string>, preferredToolNames: string[]): string | null {
  for (const toolName of preferredToolNames) {
    if (availableToolNames.has(toolName)) {
      return toolName;
    }
  }

  return null;
}

// Macros are provider-specific, so fallback attempts must create a fresh resolver instead of reusing the primary
// model's.
export function createToolPromptMacroResolverForState(
  tomoriState: TomoriState,
  deliberateToolAllowedNames?: readonly string[],
): ToolPromptMacroResolver {
  return createToolPromptMacroResolver({
    provider: tomoriState.llm.llm_provider,
    deliberateToolAllowedNames,
    capabilities: resolvePromptCapabilityValues(tomoriState.config, tomoriState.llm.has_tools),
    stateForContext:
      tomoriState.server_id && tomoriState.llm
        ? {
            server_id: tomoriState.server_id.toString(),
            activePersonaHasElevenlabsVoice: false,
            llm: tomoriState.llm,
            diffusion_model_id: tomoriState.config.diffusion_model_id,
            nai_diffusion_model_id: tomoriState.config.nai_diffusion_model_id,
            video_model_id: tomoriState.config.video_model_id,
            config: {
              emoji_usage_enabled: tomoriState.config.emoji_usage_enabled,
              sticker_usage_enabled: tomoriState.config.sticker_usage_enabled,
              web_search_enabled: tomoriState.config.web_search_enabled,
              self_teaching_enabled: tomoriState.config.self_teaching_enabled,
              manage_message_enabled: tomoriState.config.manage_message_enabled,
              imagegen_enabled: tomoriState.config.imagegen_enabled,
              videogen_enabled: tomoriState.config.videogen_enabled,
              voice_message_enabled: tomoriState.config.voice_message_enabled,
              user_blocking_enabled: tomoriState.config.user_blocking_enabled,
              user_info_updates_enabled: tomoriState.config.user_info_updates_enabled,
              thread_creation_enabled: tomoriState.config.thread_creation_enabled,
              conditioning_interactions_enabled: tomoriState.config.conditioning_interactions_enabled,
              dice_rolling_enabled: tomoriState.config.dice_rolling_enabled,
              danbooru_enabled: tomoriState.config.danbooru_enabled,
            },
          }
        : undefined,
  });
}
