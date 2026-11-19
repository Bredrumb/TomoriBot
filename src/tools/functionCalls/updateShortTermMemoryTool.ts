import {
  BaseTool,
  type Tool,
  type ToolAssemblyContext,
  type ToolContext,
  type ToolParameterSchema,
  type ToolResult,
  type ToolStringParameterSchema,
} from "../../types/tool/interfaces";
import {
  updateShortTermMemorySummary,
  updateShortTermMemoryCategories,
  resetStmTurnCounter,
  MAX_SUMMARY_LENGTH,
} from "../../utils/cache/shortTermMemoryCache";
import { log } from "../../utils/misc/logger";
import { sanitizeUnknownTemplatePlaceholders } from "@/utils/text/processors/mentionProcessor";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { buildSlugMap } from "@/utils/text/slugifyLabel";
import {
  createToolPromptMacroResolver,
  resolvePromptCapabilityValuesFromToolState,
} from "@/utils/tools/toolPromptMacros";

const SUMMARY_PARAMETERS: ToolParameterSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "A comprehensive summary of the current story or conversation's key points, topics, or context. Focus on what's relevant for potential future messages in this conversation, but add enough helpful details.",
    } satisfies ToolStringParameterSchema,
  },
  required: ["summary"],
};

export const DEFAULT_STM_TOOL_DESCRIPTION =
  "Update your short-term working memory for the current story or conversation. Use this to remember important context from this ongoing conversation that you might need later, but don't need to store permanently. Do NOT use this when a user explicitly asks you to remember/save/store something for future conversations; use update_long_term_memory or create_long_term_memory for that.";

export class UpdateShortTermMemoryTool extends BaseTool {
  name = "update_short_term_memory";
  description = DEFAULT_STM_TOOL_DESCRIPTION;
  category = "memory" as const;

  parameters: ToolParameterSchema = SUMMARY_PARAMETERS;

  isAvailableForContext(provider: string, context?: ToolContext): boolean {
    if (!this.isAvailableFor(provider)) return false;

    // Per-server master switch (migration 054): when STM is disabled, do not offer the
    // tool at all. Only `false` blocks: an undefined config (e.g. no context) is treated
    // as enabled so default/backward-compatible behavior is preserved.
    if (context?.tomoriState?.config?.short_term_memory_enabled === false) {
      log.info("UpdateShortTermMemoryTool: Disabled for this server — short_term_memory_enabled is off");
      return false;
    }

    if (context?.streamContext?.explicitLongTermMemoryIntent) {
      log.info("UpdateShortTermMemoryTool: Disabled for this turn — explicit long-term memory intent detected");
      return false;
    }

    if (context?.streamContext?.disableShortTermMemoryUpdate) {
      log.info("UpdateShortTermMemoryTool: Disabled for this turn — STM already updated once");
      return false;
    }

    return true;
  }

  async assembleForContext(context: ToolAssemblyContext): Promise<Tool | null> {
    const serverId = Number.parseInt(context.state.server_id, 10);
    if (!Number.isFinite(serverId)) return this;

    const [stmConfig, categories] = await Promise.all([
      shortTermMemoryRepository.getStmConfig(serverId),
      shortTermMemoryRepository.getStmCategories(serverId),
    ]);

    // Fall back to single-summary mode when only the default category exists
    const isSummaryFallback = categories.length === 1 && categories[0].label.toLowerCase() === "summary";

    if (isSummaryFallback) return this;

    // Build slug→label map (deterministic, collision-safe)
    const slugMap = buildSlugMap(categories);

    const macroResolver = createToolPromptMacroResolver({
      provider: context.provider,
      stateForContext: context.state,
      capabilities: resolvePromptCapabilityValuesFromToolState(context.state),
      availableToolNames: context.availableToolNames,
    });

    // One optional string property per category
    const properties: Record<string, ToolStringParameterSchema> = {};
    for (const [slug, label] of slugMap) {
      const cat = categories.find((c) => c.label === label);
      properties[slug] = {
        type: "string",
        description: sanitizeUnknownTemplatePlaceholders(await macroResolver.expand(cat?.description ?? label)),
      };
    }

    const dynamicParameters: ToolParameterSchema = {
      type: "object",
      properties,
      required: [...slugMap.keys()],
    };

    // Use per-server description override when provided; expand macros and sanitize
    // so stray {placeholder} patterns don't leak unsanitized into the tool schema.
    const rawDescription = stmConfig?.tool_description_override
      ? stmConfig.tool_description_override
      : this.description;
    const toolDescription = sanitizeUnknownTemplatePlaceholders(await macroResolver.expand(rawDescription));

    // Return a variant that closes over slugMap in its execute()
    return Object.create(this, {
      description: { value: toolDescription, writable: false, enumerable: true },
      parameters: { value: dynamicParameters, writable: false, enumerable: true },
      execute: {
        enumerable: true,
        value: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
          return this._executeCategoryMode(args, ctx, slugMap);
        },
      },
    }) as this;
  }

  // Registry dispatch always calls the base tool by name rather than the assembled variant, so execute must detect
  // category mode and self-route here.
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    // Defense-in-depth: the registry dispatches by name regardless of availability, so
    // re-check the per-server master switch here (migration 054).
    if (context.tomoriState?.config?.short_term_memory_enabled === false) {
      log.info("[updateShortTermMemoryTool] Execution blocked — short-term memory disabled for this server");
      return {
        success: false,
        message: "Short-term memory is disabled for this server.",
      };
    }

    if (context.streamContext?.explicitLongTermMemoryIntent) {
      log.info("[updateShortTermMemoryTool] Execution blocked — explicit long-term memory intent detected");
      return {
        success: false,
        message: "Short-term memory updates are disabled when the user explicitly asks for persistent memory.",
      };
    }

    // Defense-in-depth guard: block execution if STM was already updated this turn
    if (context.streamContext?.disableShortTermMemoryUpdate) {
      log.info("[updateShortTermMemoryTool] Execution blocked — STM already updated once this turn");
      return {
        success: false,
        message: "Short-term memory was already updated this turn.",
      };
    }

    // Route to category mode when the server has custom categories configured.
    const numericServerId = context.tomoriState?.server_id;
    if (Number.isFinite(numericServerId) && numericServerId != null) {
      const categories = await shortTermMemoryRepository.getStmCategories(numericServerId);
      const isSummaryFallback = categories.length === 1 && categories[0].label.toLowerCase() === "summary";
      if (!isSummaryFallback && categories.length > 0) {
        const slugMap = buildSlugMap(categories);
        return this._executeCategoryMode(args, context, slugMap);
      }
    }

    log.info(`[updateShortTermMemoryTool] Tool called - userId=${context.userId}, channelId=${context.channel?.id}`);

    try {
      const summary = args.summary;

      if (typeof summary !== "string") {
        log.warn(`[updateShortTermMemoryTool] Invalid summary parameter - summaryType=${typeof summary}`);
        return {
          success: false,
          message: "Error: summary parameter must be a string",
        };
      }

      if (!summary || summary.trim().length === 0) {
        log.warn("[updateShortTermMemoryTool] Empty summary provided");
        return {
          success: false,
          message: "Error: summary cannot be empty",
        };
      }

      const triggeringUserId = context.userId;
      const channelId = context.channel.id;

      if (!triggeringUserId || !channelId) {
        await log.error(
          `[updateShortTermMemoryTool] Missing required context fields - hasTriggeringUserId=${!!triggeringUserId}, hasChannelId=${!!channelId}`,
          undefined,
          {
            errorType: "MISSING_CONTEXT",
            metadata: { userDiscId: triggeringUserId, channelId: channelId },
          },
        );
        return {
          success: false,
          message: "Error: unable to identify user or channel for this conversation",
        };
      }

      // Validate summary length (use configured max from env)
      // Sanitize unknown {word} placeholders the LLM may have written (e.g. {zallya})
      const trimmedSummary = sanitizeUnknownTemplatePlaceholders(summary.trim());

      if (trimmedSummary.length > MAX_SUMMARY_LENGTH) {
        log.info(
          `[updateShortTermMemoryTool] Summary exceeds max length, truncating - originalLength=${trimmedSummary.length}, maxLength=${MAX_SUMMARY_LENGTH}`,
        );
        // Truncate will happen in the cache function
      }

      const serverId = context.guildId || "DM";
      const serverName = "guild" in context.channel ? context.channel.guild?.name : undefined;
      const channelName = "name" in context.channel ? context.channel.name : undefined;

      const personaId = context.tomoriState?.persona_id ?? null;
      const personaLineageId = context.tomoriState?.persona_lineage_id ?? null;
      const userCacheKey = personaId
        ? `shortterm:user:${triggeringUserId}:${channelId}:${personaId}`
        : `shortterm:user:${triggeringUserId}:${channelId}`;
      const serverCacheKey =
        serverId === "DM"
          ? "n/a"
          : personaId
            ? `shortterm:server:${serverId}:${channelId}:${personaId}`
            : `shortterm:server:${serverId}:${channelId}`;
      log.info(
        `[updateShortTermMemoryTool] [TOOL_EXECUTE] Calling updateShortTermMemorySummary - userCacheKey=${userCacheKey}, serverCacheKey=${serverCacheKey}, summaryLength=${trimmedSummary.length}, serverId=${serverId}, personaId=${personaId}, personaLineageId=${personaLineageId}`,
      );

      updateShortTermMemorySummary(
        triggeringUserId,
        channelId,
        trimmedSummary,
        serverId,
        serverName,
        channelName,
        personaId,
        personaLineageId,
      );
      const liveServerId = serverId !== "DM" ? serverId : null;
      const liveDmUserId = serverId === "DM" ? triggeringUserId : null;
      void resetStmTurnCounter(channelId, liveServerId, liveDmUserId, personaId);

      log.success(
        `[updateShortTermMemoryTool] [TOOL_EXECUTE] Updated short-term memory - userCacheKey=${userCacheKey}, serverCacheKey=${serverCacheKey}, summaryLength=${Math.min(trimmedSummary.length, MAX_SUMMARY_LENGTH)}`,
      );

      return {
        success: true,
        message: "Short-term memory updated successfully (no user notification)",
      };
    } catch (error) {
      await log.error("[updateShortTermMemoryTool] Failed to update short-term memory", error, {
        errorType: "UPDATE_SHORT_TERM_MEMORY_ERROR",
      });

      return {
        success: false,
        message: `Error updating short-term memory: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  private async _executeCategoryMode(
    args: Record<string, unknown>,
    context: ToolContext,
    slugMap: Map<string, string>,
  ): Promise<ToolResult> {
    // Defense-in-depth master-switch guard (migration 054), mirroring execute().
    if (context.tomoriState?.config?.short_term_memory_enabled === false) {
      log.info("[updateShortTermMemoryTool] [category] Blocked — short-term memory disabled for this server");
      return { success: false, message: "Short-term memory is disabled for this server." };
    }

    if (context.streamContext?.explicitLongTermMemoryIntent) {
      log.info("[updateShortTermMemoryTool] [category] Blocked — explicit long-term memory intent");
      return {
        success: false,
        message: "Short-term memory updates are disabled when the user explicitly asks for persistent memory.",
      };
    }

    if (context.streamContext?.disableShortTermMemoryUpdate) {
      log.info("[updateShortTermMemoryTool] [category] Blocked — STM already updated this turn");
      return {
        success: false,
        message: "Short-term memory was already updated this turn.",
      };
    }

    const triggeringUserId = context.userId;
    const channelId = context.channel?.id;

    if (!triggeringUserId || !channelId) {
      await log.error("[updateShortTermMemoryTool] [category] Missing context fields", undefined, {
        errorType: "MISSING_CONTEXT",
        metadata: { userDiscId: triggeringUserId, channelId },
      });
      return { success: false, message: "Error: unable to identify user or channel for this conversation" };
    }

    try {
      const categories: Record<string, string> = {};
      for (const [slug] of slugMap) {
        const raw = args[slug];
        if (typeof raw === "string" && raw.trim()) {
          const sanitized = sanitizeUnknownTemplatePlaceholders(raw.trim());
          categories[slug] = sanitized.length > MAX_SUMMARY_LENGTH ? sanitized.slice(0, MAX_SUMMARY_LENGTH) : sanitized;
        }
      }

      if (Object.keys(categories).length === 0) {
        log.warn("[updateShortTermMemoryTool] [category] All category fields empty — skipping write");
        return { success: false, message: "Error: at least one category field must be provided" };
      }

      const serverId = context.guildId || "DM";
      const serverName = "guild" in context.channel ? context.channel.guild?.name : undefined;
      const channelName = "name" in context.channel ? context.channel.name : undefined;

      const personaId = context.tomoriState?.persona_id ?? null;
      const personaLineageId = context.tomoriState?.persona_lineage_id ?? null;

      log.info(
        `[updateShortTermMemoryTool] [category] Writing categories - channelId=${channelId}, serverId=${serverId}, personaId=${personaId}, categoryCount=${Object.keys(categories).length}`,
      );

      await updateShortTermMemoryCategories(
        triggeringUserId,
        channelId,
        categories,
        serverId,
        serverName,
        channelName,
        personaId,
        personaLineageId,
      );

      // Reset cadence counter after successful refresh
      const liveServerId = serverId !== "DM" ? serverId : null;
      const liveDmUserId = serverId === "DM" ? triggeringUserId : null;
      void resetStmTurnCounter(channelId, liveServerId, liveDmUserId, personaId);

      log.success(
        `[updateShortTermMemoryTool] [category] Categories updated - channelId=${channelId}, serverId=${serverId}`,
      );

      return {
        success: true,
        message: "Short-term memory updated successfully (no user notification)",
      };
    } catch (error) {
      await log.error("[updateShortTermMemoryTool] [category] Failed to update categories", error, {
        errorType: "UPDATE_SHORT_TERM_MEMORY_ERROR",
      });
      return {
        success: false,
        message: `Error updating short-term memory: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }
}
