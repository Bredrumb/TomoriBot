/**
 * Update Short Term Memory Tool
 *
 * Allows the bot to update its short-term working memory for the current conversation.
 * This tool is used to remember key topics, user preferences, or important context from
 * ongoing conversations that don't need to be stored permanently.
 *
 * Features:
 * - Silent operation (no user-facing message)
 * - Available for all tool-calling models (no feature flag required)
 * - 500 character limit to prevent token bloat
 * - Replaces crude conversation with summary for efficient context usage
 *
 * Phase 3: Tool-Based Summarization
 */

import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "../../types/tool/interfaces";
import { updateShortTermMemorySummary, MAX_SUMMARY_LENGTH } from "../../utils/cache/shortTermMemoryCache";
import { log } from "../../utils/misc/logger";
import { sanitizeUnknownTemplatePlaceholders } from "../../utils/text/stringHelper";

export class UpdateShortTermMemoryTool extends BaseTool {
  name = "update_short_term_memory";
  description =
    "Update your short-term working memory for the current story or conversation. Use this to remember important context from this ongoing conversation that you might need later, but don't need to store permanently. Do NOT use this when a user explicitly asks you to remember/save/store something for future conversations; use update_long_term_memory or create_long_term_memory for that.";
  category = "memory" as const;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "A comprehensive summary of the current story or conversation's key points, topics, or context. Focus on what's relevant for potential future messages in this conversation, but add enough helphful details.",
      },
    },
    required: ["summary"],
  };

  /**
   * Check if this tool is available for a given provider.
   * Disabled for NovelAI — GLM 4.6's limited token budget (~2800 tokens) makes
   * short-term memory updates impractical; the tool definition and STM prompts
   * consume tokens better spent on core conversation context.
   * @param provider - LLM provider name
   * @returns True if provider supports short-term memory updates
   */
  isAvailableFor(provider: string): boolean {
    if (provider === "novelai") return false;
    return true;
  }

  /**
   * Enhanced availability check that also considers per-turn disable flags.
   * Once STM has been updated once in a turn, the flag is set to prevent
   * the LLM from calling this tool again in the same turn.
   * @param provider - LLM provider name
   * @param context - Tool context that may contain streaming flags
   * @returns True if tool should be offered to the LLM
   */
  isAvailableForContext(provider: string, context?: ToolContext): boolean {
    if (!this.isAvailableFor(provider)) return false;

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

  /**
   * Execute the tool to update short-term memory summary
   */
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
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

    log.info(`[updateShortTermMemoryTool] Tool called - userId=${context.userId}, channelId=${context.channel?.id}`);

    try {
      // 1. Validate parameters
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

      // 2. Extract userId and channelId from context
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

      // 3. Validate summary length (use configured max from env)
      // Sanitize unknown {word} placeholders the LLM may have written (e.g. {bredrumb})
      const trimmedSummary = sanitizeUnknownTemplatePlaceholders(summary.trim());

      if (trimmedSummary.length > MAX_SUMMARY_LENGTH) {
        log.info(
          `[updateShortTermMemoryTool] Summary exceeds max length, truncating - originalLength=${trimmedSummary.length}, maxLength=${MAX_SUMMARY_LENGTH}`,
        );
        // Truncate will happen in the cache function
      }

      // 4. Extract server and channel info for new entries
      const serverId = context.guildId || "DM";
      const serverName = "guild" in context.channel ? context.channel.guild?.name : undefined;
      const channelName = "name" in context.channel ? context.channel.name : undefined;
      const parentChannelId =
        "isThread" in context.channel &&
        typeof context.channel.isThread === "function" &&
        context.channel.isThread() &&
        "parentId" in context.channel
          ? (context.channel.parentId ?? null)
          : null;

      // 5. Update both the user-scoped STM and, in guilds, the shared server STM
      const tomoriId = context.tomoriState?.tomori_id ?? null;
      const personaLineageId = context.tomoriState?.persona_lineage_id ?? null;
      const userCacheKey = tomoriId
        ? `shortterm:user:${triggeringUserId}:${channelId}:${tomoriId}`
        : `shortterm:user:${triggeringUserId}:${channelId}`;
      const serverCacheKey =
        serverId === "DM"
          ? "n/a"
          : tomoriId
            ? `shortterm:server:${serverId}:${channelId}:${tomoriId}`
            : `shortterm:server:${serverId}:${channelId}`;
      log.info(
        `[updateShortTermMemoryTool] [TOOL_EXECUTE] Calling updateShortTermMemorySummary - userCacheKey=${userCacheKey}, serverCacheKey=${serverCacheKey}, summaryLength=${trimmedSummary.length}, serverId=${serverId}, tomoriId=${tomoriId}, personaLineageId=${personaLineageId}`,
      );

      updateShortTermMemorySummary(
        triggeringUserId,
        channelId,
        trimmedSummary,
        serverId,
        serverName,
        channelName,
        tomoriId,
        personaLineageId,
        parentChannelId,
      );

      log.success(
        `[updateShortTermMemoryTool] [TOOL_EXECUTE] Updated short-term memory - userCacheKey=${userCacheKey}, serverCacheKey=${serverCacheKey}, summaryLength=${Math.min(trimmedSummary.length, MAX_SUMMARY_LENGTH)}`,
      );

      // 6. Return success with no user-facing message (silent operation)
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
}
