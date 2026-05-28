import { ChannelType } from "discord.js";
import type { Tool, ToolAvailabilityLlmState, ToolContext } from "@/types/tool/interfaces";
import { ELEVENLABS_SERVICE_NAME } from "@/utils/audio/elevenLabsAccount";
import { getCachedEnabledGuildMcpConfigs } from "@/utils/cache/guildMcpConfigCache";
import { sql } from "@/utils/db/client";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { getMCPManager } from "@/utils/mcp/mcpManager";
import { log } from "@/utils/misc/logger";
import { resolveActiveSpeechEndpoint } from "@/utils/provider/speechEndpointResolver";
import { hasOptApiKey } from "@/utils/security/crypto";
import { configToFeatureFlags, filterToolsByFeatureFlags } from "@/utils/tools/featureFlagMapper";
import { VOICE_TOOL_VARIANTS, type VoiceScriptMarkup } from "@/tools/functionCalls/generateVoiceMessageTool";
import { shouldUseVoiceDesignForPersona } from "@/providers/custom/styles/ttsVoiceDesignAdapter";

/**
 * Minimal state interface for context building operations.
 * Contains only what's needed for feature flag checking without full Discord context.
 */
export interface ToolStateForContext {
  server_id: string;
  /** True when the active persona has either a local voice sample or provider-hosted voice assigned. */
  activePersonaHasElevenlabsVoice: boolean;
  /** Present when the active persona should use instruct-based VoiceDesign synthesis. */
  activePersonaVoiceDesignPrompt?: string | null;
  /** Display/name marker for the active speech voice selection. */
  activePersonaVoiceName?: string | null;
  llm: ToolAvailabilityLlmState;
  diffusion_model_id?: number | null;
  nai_diffusion_model_id?: number | null;
  video_model_id?: number | null;
  config: {
    sticker_usage_enabled: boolean;
    web_search_enabled: boolean;
    self_teaching_enabled: boolean;
    manage_message_enabled: boolean;
    imagegen_enabled: boolean;
    videogen_enabled: boolean;
    voice_message_enabled: boolean;
    thread_creation_enabled: boolean;
  };
}

export interface AvailableToolsWithMCP {
  builtInTools: Tool[];
  mcpFunctionNames: string[];
  totalCount: number;
}

export function getAvailableToolsForProvider(tools: Iterable<Tool>, provider: string, context: ToolContext): Tool[] {
  const availableTools: Tool[] = [];

  for (const tool of tools) {
    try {
      const isToolAvailable =
        "isAvailableForContext" in tool && typeof tool.isAvailableForContext === "function"
          ? tool.isAvailableForContext(provider, context)
          : tool.isAvailableFor(provider);

      if (!isToolAvailable) {
        continue;
      }

      if (!meetsModelCapabilityRequirements(tool, context.tomoriState.llm)) {
        continue;
      }

      if (tool.requiresFeatureFlag && !checkFeatureFlag(tool.requiresFeatureFlag, context)) {
        continue;
      }

      if (tool.requiresPermissions?.length && !checkPermissions(tool.requiresPermissions, context)) {
        continue;
      }

      availableTools.push(tool);
    } catch (error) {
      log.warn(`Error checking availability for tool ${tool.name}: ${(error as Error).message}`);
    }
  }

  log.info(
    `Found ${availableTools.length} available tools for provider: ${provider} (${availableTools.map((t) => t.name).join(", ")})`,
  );

  return availableTools;
}

export function getAvailableToolsForContext(
  tools: Iterable<Tool>,
  provider: string,
  stateForContext: ToolStateForContext,
): Tool[] {
  const availableTools: Tool[] = [];

  for (const tool of tools) {
    try {
      if (!tool.isAvailableFor(provider)) {
        continue;
      }

      if (!meetsModelCapabilityRequirements(tool, stateForContext.llm)) {
        continue;
      }

      if (tool.requiresFeatureFlag && !checkFeatureFlagOnly(tool.requiresFeatureFlag, stateForContext)) {
        continue;
      }

      availableTools.push(tool);
    } catch (error) {
      log.warn(`Error checking availability for tool ${tool.name}: ${(error as Error).message}`);
    }
  }

  log.info(
    `Found ${availableTools.length} available tools for context building with provider: ${provider} (${availableTools.map((t) => t.name).join(", ")})`,
  );

  return availableTools;
}

export async function getAvailableToolsWithMCP(
  tools: Iterable<Tool>,
  provider: string,
  stateForContext: ToolStateForContext,
): Promise<AvailableToolsWithMCP> {
  try {
    let builtInTools = getAvailableToolsForContext(tools, provider, stateForContext);
    const featureFlags = configToFeatureFlags(stateForContext.config);
    let mcpFunctionNames: string[] = [];
    const mcpManager = getMCPManager();

    if (mcpManager.isReady()) {
      const allMCPFunctionNames: string[] = [];
      const mcpTools = mcpManager.getMCPTools();

      for (const mcpTool of mcpTools) {
        try {
          const geminiTool = await mcpTool.tool();
          if (geminiTool.functionDeclarations) {
            for (const declaration of geminiTool.functionDeclarations) {
              allMCPFunctionNames.push((declaration as { name: string }).name);
            }
          }
        } catch (error) {
          log.warn("Failed to extract function names from MCP tool:", error as Error);
        }
      }

      let filteredByFeatureFlags = filterToolsByFeatureFlags(allMCPFunctionNames, featureFlags);

      // 1. Unconditionally hide the DDG/Felo/iask/monica MCP function names from the LLM.
      //    They are now consumed only via the unified `web_search` tool through
      //    `webSearch/duckduckgoEngine.ts` / `feloEngine.ts`. This replaces the
      //    previous "Brave key present ⇒ filter DDG MCP functions" dedup, which
      //    became unconditional once those names ceased to be LLM-visible.
      const hiddenWebSearchMcpFunctions = ["web-search", "felo-search", "iask-search", "monica-search"];
      const originalCount = filteredByFeatureFlags.length;
      filteredByFeatureFlags = filteredByFeatureFlags.filter(
        (functionName) => !hiddenWebSearchMcpFunctions.includes(functionName),
      );
      const excludedCount = originalCount - filteredByFeatureFlags.length;

      if (excludedCount > 0) {
        log.info(
          `Excluded ${excludedCount} web-search MCP function names — now consumed only via unified web_search tool.`,
        );
      }

      mcpFunctionNames = filteredByFeatureFlags;

      log.info(
        `MCP tools: ${allMCPFunctionNames.length} total, ${mcpFunctionNames.length} after centralized filtering (feature flags + provider preferences)`,
      );
    }

    const serverIdNum = stateForContext.server_id ? Number.parseInt(stateForContext.server_id, 10) : undefined;
    if (serverIdNum) {
      try {
        const guildMcpManager = getGuildMcpManager();
        const guildFunctionNames = await guildMcpManager.getGuildMCPFunctionNames(serverIdNum);

        if (guildFunctionNames.length > 0) {
          const builtInNames = new Set(builtInTools.map((t) => t.name));
          const globalMcpNames = new Set(mcpFunctionNames);

          const safeGuildNames = guildFunctionNames.filter((name) => {
            if (builtInNames.has(name) || globalMcpNames.has(name)) {
              log.warn(`[GuildMCP] Skipping guild MCP function "${name}" - collides with built-in or global MCP tool`);
              return false;
            }
            return true;
          });

          mcpFunctionNames.push(...safeGuildNames);
          log.info(
            `Guild MCP tools: ${guildFunctionNames.length} discovered, ${safeGuildNames.length} after collision check (server: ${serverIdNum})`,
          );
        }
      } catch (error) {
        log.warn("[GuildMCP] Failed to get guild MCP function names, continuing without", error);
      }
    }

    if (serverIdNum) {
      try {
        const enabledConfigs = await getCachedEnabledGuildMcpConfigs(serverIdNum);
        const guildServerTypes = new Set(enabledConfigs.map((c) => c.server_type).filter(Boolean));

        if (guildServerTypes.has("web_search")) {
          // 1. After the unified `web_search` tool migration the only LLM-visible
          //    search name is `web_search` itself. The previous brave_*/DDG MCP
          //    names are no longer LLM-visible, so we just need to dedup against
          //    the unified tool name when a guild brings its own web_search MCP.
          const webSearchFunctions = ["web_search", "url-metadata"];
          const beforeCount = mcpFunctionNames.length;
          mcpFunctionNames = mcpFunctionNames.filter((name) => !webSearchFunctions.includes(name));
          const excludedCount = beforeCount - mcpFunctionNames.length;
          if (excludedCount > 0) {
            log.info(`Excluded ${excludedCount} web search MCP functions (guild has web_search server type)`);
          }
        }

        if (guildServerTypes.has("url_fetcher")) {
          const fetchFunctions = ["fetch", "fetch-url"];
          const beforeCount = mcpFunctionNames.length;
          mcpFunctionNames = mcpFunctionNames.filter((name) => !fetchFunctions.includes(name));
          const excludedCount = beforeCount - mcpFunctionNames.length;
          if (excludedCount > 0) {
            log.info(`Excluded ${excludedCount} URL fetch MCP functions (guild has url_fetcher server type)`);
          }
        }
      } catch (error) {
        log.warn("[GuildMCP] Failed to check server types for deduplication, continuing without", error);
      }
    }

    const serverIdNumber = stateForContext.server_id ? Number.parseInt(stateForContext.server_id, 10) : undefined;
    if (serverIdNumber) {
      const activeSpeechEndpoint = await resolveActiveSpeechEndpoint(serverIdNumber);
      const hasElevenLabsOptKey = await hasOptApiKey(serverIdNumber, ELEVENLABS_SERVICE_NAME);
      const hasSpeechProvider = Boolean(activeSpeechEndpoint) || hasElevenLabsOptKey;
      // 1. Read split-table model slots: diffusion_model_id/video_model_id live in
      //    server_model_configs; nai_diffusion_model_id lives in server_novelai_imagegen_configs.
      const [toolConfigRow] = await sql<
        [{ diffusion_model_id: number | null; nai_diffusion_model_id: number | null; video_model_id: number | null }]
      >`
        SELECT smc.diffusion_model_id,
               snic.nai_diffusion_model_id,
               smc.video_model_id
        FROM server_model_configs smc
        LEFT JOIN server_novelai_imagegen_configs snic ON snic.server_id = smc.server_id
        WHERE smc.server_id = ${serverIdNumber}
        LIMIT 1
      `;

      const hasStandardImageSlot =
        stateForContext.diffusion_model_id != null || toolConfigRow?.diffusion_model_id != null;
      const hasNaiImageSlot =
        stateForContext.nai_diffusion_model_id != null || toolConfigRow?.nai_diffusion_model_id != null;
      const hasVideoSlot = stateForContext.video_model_id != null || toolConfigRow?.video_model_id != null;

      if (!hasNaiImageSlot) {
        const beforeCount = builtInTools.length;
        builtInTools = builtInTools.filter((tool) => tool.name !== "generate_image_nai");
        if (builtInTools.length < beforeCount) {
          log.info("Excluded generate_image_nai (no NovelAI image slot configured)");
        }
      }

      if (!hasStandardImageSlot) {
        const beforeCount = builtInTools.length;
        builtInTools = builtInTools.filter((tool) => tool.name !== "generate_image");
        if (builtInTools.length < beforeCount) {
          log.info("Excluded generate_image (no standard image slot configured)");
        }
      }

      if (!hasVideoSlot) {
        const beforeCount = builtInTools.length;
        builtInTools = builtInTools.filter((tool) => tool.name !== "generate_video");
        if (builtInTools.length < beforeCount) {
          log.info("Excluded generate_video (no video slot configured)");
        }
      }

      if (
        !hasSpeechProvider ||
        !stateForContext.activePersonaHasElevenlabsVoice ||
        !stateForContext.config.voice_message_enabled
      ) {
        const beforeCount = builtInTools.length;
        builtInTools = builtInTools.filter((tool) => tool.name !== "generate_voice_message");
        if (builtInTools.length < beforeCount) {
          log.info(
            `Excluded generate_voice_message (${
              !hasSpeechProvider
                ? "no speech provider"
                : !stateForContext.activePersonaHasElevenlabsVoice
                  ? "active persona has no assigned voice"
                  : "voice_message_enabled is disabled"
            })`,
          );
        }
      } else {
        const scriptMarkup =
          (activeSpeechEndpoint?.endpoint.extra_config?.script_markup as string | undefined) ?? "bracket-tags";
        const voiceDesign = shouldUseVoiceDesignForPersona(
          activeSpeechEndpoint?.endpoint,
          stateForContext.activePersonaVoiceDesignPrompt,
          stateForContext.activePersonaVoiceName,
        );
        const variant = voiceDesign
          ? VOICE_TOOL_VARIANTS["voice-design"]
          : (VOICE_TOOL_VARIANTS[scriptMarkup as VoiceScriptMarkup] ?? VOICE_TOOL_VARIANTS["bracket-tags"]);

        builtInTools = builtInTools.map((tool) => {
          if (tool.name !== "generate_voice_message") return tool;
          return Object.create(tool, {
            description: { value: variant.toolDescription, enumerable: true },
            parameters: {
              value: {
                ...tool.parameters,
                properties: {
                  ...tool.parameters.properties,
                  script: {
                    ...tool.parameters.properties.script,
                    description: variant.scriptDescription,
                  },
                  ...(voiceDesign
                    ? {
                        voice_instructions: {
                          type: "string" as const,
                          description: VOICE_TOOL_VARIANTS["voice-design"].voiceInstructionsDescription,
                        },
                      }
                    : {}),
                },
              },
              enumerable: true,
            },
          });
        });
      }
    }

    const totalCount = builtInTools.length + mcpFunctionNames.length;

    log.info(
      `Centralized tool filtering complete: ${builtInTools.length} built-in + ${mcpFunctionNames.length} MCP = ${totalCount} total tools for provider: ${provider}`,
    );

    return {
      builtInTools,
      mcpFunctionNames,
      totalCount,
    };
  } catch (error) {
    log.error("Failed to get available tools with MCP:", error as Error);

    const builtInTools = getAvailableToolsForContext(tools, provider, stateForContext);
    return {
      builtInTools,
      mcpFunctionNames: [],
      totalCount: builtInTools.length,
    };
  }
}

function meetsModelCapabilityRequirements(tool: Tool, llm: ToolAvailabilityLlmState): boolean {
  if (!tool.requiredModelCapabilities) {
    return true;
  }

  return Object.entries(tool.requiredModelCapabilities).every(
    ([capability, expectedValue]) => llm[capability as keyof ToolAvailabilityLlmState] === expectedValue,
  );
}

function checkFeatureFlag(featureFlag: string, context: ToolContext): boolean {
  const featureFlags = configToFeatureFlags(context.tomoriState.config);
  return featureFlags[featureFlag] ?? false;
}

function checkFeatureFlagOnly(featureFlag: string, stateForContext: ToolStateForContext): boolean {
  const featureFlags = configToFeatureFlags(stateForContext.config);
  return featureFlags[featureFlag] ?? false;
}

function checkPermissions(requiredPermissions: string[], context: ToolContext): boolean {
  if (requiredPermissions.includes("SEND_MESSAGES")) {
    const clientUser = context.client.user;
    if (!clientUser) {
      return false;
    }
    if ("permissionsFor" in context.channel) {
      const permissions = context.channel.permissionsFor(clientUser);
      if (!permissions) {
        return false;
      }
      const isThreadChannel =
        context.channel.type === ChannelType.PublicThread ||
        context.channel.type === ChannelType.PrivateThread ||
        context.channel.type === ChannelType.AnnouncementThread;
      const canSend = isThreadChannel ? permissions.has("SendMessagesInThreads") : permissions.has("SendMessages");
      if (!canSend) {
        return false;
      }
    }
  }

  if (requiredPermissions.includes("USE_EXTERNAL_STICKERS")) {
    const clientUser = context.client.user;
    if (
      !clientUser ||
      !("permissionsFor" in context.channel
        ? context.channel.permissionsFor(clientUser)?.has("UseExternalStickers")
        : true)
    ) {
      return false;
    }
  }

  return true;
}
