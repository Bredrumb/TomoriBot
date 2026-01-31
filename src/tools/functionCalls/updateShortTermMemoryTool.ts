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

import {
	BaseTool,
	type ToolContext,
	type ToolResult,
	type ToolParameterSchema,
} from "../../types/tool/interfaces";
import {
	updateShortTermMemorySummary,
	MAX_SUMMARY_LENGTH,
} from "../../utils/cache/shortTermMemoryCache";
import { log } from "../../utils/misc/logger";

export class UpdateShortTermMemoryTool extends BaseTool {
	name = "update_short_term_memory";
	description =
		"Update your short-term working memory for the current conversation. Use this to remember key topics, user preferences, or important context from this ongoing conversation that you might need later, but don't need to store permanently.";
	category = "memory" as const;

	parameters: ToolParameterSchema = {
		type: "object",
		properties: {
			summary: {
				type: "string",
				description:
					"A concise summary of the current conversation's key points, topics, or context to remember. Focus on what's relevant for potential future messages in this conversation.",
			},
		},
		required: ["summary"],
	};

	/**
	 * Check if this tool is available for a given provider
	 * Available for all providers that support tools
	 */
	isAvailableFor(_provider: string): boolean {
		// Available for all tool-calling models
		return true;
	}

	/**
	 * Execute the tool to update short-term memory summary
	 */
	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		log.info(
			`[updateShortTermMemoryTool] Tool called - userId=${context.userId}, channelId=${context.channel?.id}`,
		);

		try {
			// 1. Validate parameters
			const summary = args.summary;

			if (typeof summary !== "string") {
				log.warn(
					`[updateShortTermMemoryTool] Invalid summary parameter - summaryType=${typeof summary}`,
				);
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
					message:
						"Error: unable to identify user or channel for this conversation",
				};
			}

			// 3. Validate summary length (use configured max from env)
			const trimmedSummary = summary.trim();

			if (trimmedSummary.length > MAX_SUMMARY_LENGTH) {
				log.info(
					`[updateShortTermMemoryTool] Summary exceeds max length, truncating - originalLength=${trimmedSummary.length}, maxLength=${MAX_SUMMARY_LENGTH}`,
				);
				// Truncate will happen in the cache function
			}

			// 4. Extract server and channel info for new entries
			const serverId = context.guildId || "DM";
			const serverName =
				"guild" in context.channel ? context.channel.guild?.name : undefined;
			const channelName = "name" in context.channel ? context.channel.name : undefined;

			// 5. Update short-term memory summary
			const cacheKey = `shortterm:${triggeringUserId}:${channelId}`;
			log.info(
				`[updateShortTermMemoryTool] [TOOL_EXECUTE] Calling updateShortTermMemorySummary - cacheKey=${cacheKey}, summaryLength=${trimmedSummary.length}, serverId=${serverId}`,
			);

			updateShortTermMemorySummary(
				triggeringUserId,
				channelId,
				trimmedSummary,
				serverId,
				serverName,
				channelName,
			);

			log.success(
				`[updateShortTermMemoryTool] [TOOL_EXECUTE] Updated short-term memory - cacheKey=${cacheKey}, summaryLength=${Math.min(trimmedSummary.length, MAX_SUMMARY_LENGTH)}`,
			);

			// 6. Return success with no user-facing message (silent operation)
			return {
				success: true,
				message: "Short-term memory updated successfully (no user notification)",
			};
		} catch (error) {
			await log.error(
				"[updateShortTermMemoryTool] Failed to update short-term memory",
				error,
				{
					errorType: "UPDATE_SHORT_TERM_MEMORY_ERROR",
				},
			);

			return {
				success: false,
				message: `Error updating short-term memory: ${error instanceof Error ? error.message : "Unknown error"}`,
			};
		}
	}
}
