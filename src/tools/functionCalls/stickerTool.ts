/**
 * Discord Sticker Selection Tool
 * Allows the AI to select appropriate stickers to accompany responses
 */

import { log } from "../../utils/misc/logger";
import {
	BaseTool,
	type ToolContext,
	type ToolResult,
	type ToolParameterSchema,
} from "../../types/tool/interfaces";

/**
 * Tool for selecting Discord stickers based on conversational context
 */
export class StickerTool extends BaseTool {
	name = "select_sticker_for_response";
	description =
		"Selects a specific sticker from the available server stickers that is relevant to the current conversational context. Use this to choose a sticker that expresses an emotion or reaction aligning with the sticker's name or description. You will be informed of the selection result and will then generate the final text message for the user.";
	category = "discord" as const;
	requiresFeatureFlag = "sticker_usage";
	requiresPermissions = ["USE_EXTERNAL_STICKERS"];

	parameters: ToolParameterSchema = {
		type: "object",
		properties: {
			sticker_name: {
				type: "string",
				description:
					"The sticker name to select (case-insensitive). Use the names from the provided list; do not include IDs.",
			},
			sticker_id: {
				type: "string",
				description:
					"Deprecated: The sticker ID. Use sticker_name instead (kept for compatibility).",
			},
		},
		required: ["sticker_name"],
	};

	/**
	 * Check if sticker tool is available for the given provider
	 * @param _provider - LLM provider name (unused)
	 * @returns True if provider supports sticker selection
	 */
	isAvailableFor(_provider: string): boolean {
		// Stickers work with all providers
		return true;
	}

	/**
	 * Check if sticker functionality is enabled in Tomori config
	 * @param context - Tool execution context
	 * @returns True if sticker usage is enabled
	 */
	protected isEnabled(context: ToolContext): boolean {
		return context.tomoriState.config.sticker_usage_enabled;
	}

	/**
	 * Execute sticker selection - Real implementation from tomoriChat.ts
	 * @param args - Arguments containing sticker_name (preferred) or sticker_id
	 * @param context - Tool execution context
	 * @returns Promise resolving to tool result
	 */
	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const rawStickerName = args.sticker_name;
		const rawStickerId = args.sticker_id;
		const stickerName =
			typeof rawStickerName === "string" ? rawStickerName.trim() : "";
		const stickerId = typeof rawStickerId === "string" ? rawStickerId.trim() : "";
		const hasStickerName = stickerName.length > 0;
		const hasStickerId = stickerId.length > 0;

		if (!hasStickerName && !hasStickerId) {
			return {
				success: false,
				error: "Invalid parameters: missing sticker_name or sticker_id",
				message:
					"Provide a sticker_name (preferred) or a valid sticker_id.",
			};
		}

		// Check if tool is enabled
		if (!this.isEnabled(context)) {
			return {
				success: false,
				error: "Sticker usage is disabled for this server",
				message: "Sticker functionality is not enabled for this server.",
			};
		}

		// Check if this is a DM channel - stickers are not available in DMs
		if (!("guild" in context.channel)) {
			return {
				success: false,
				error: "Stickers not available in DMs",
				message: "Stickers are not available in Direct Messages.",
			};
		}

		const normalizedStickerName = hasStickerName
			? stickerName.replace(/^:(.*):$/, "$1").trim()
			: "";

		try {
			log.info(
				`Attempting to select sticker: ${normalizedStickerName || stickerId}`,
			);

			// Get the guild from channel context
			const guild = context.channel.guild;

			/**
			 * Helper function to lookup sticker from cache
			 * @returns Sticker if found, null otherwise
			 */
			const lookupSticker = () => {
				if (normalizedStickerName) {
					const nameKey = normalizedStickerName.toLowerCase();
					const matchingStickers = guild.stickers.cache.filter(
						(sticker) => sticker.name?.toLowerCase() === nameKey,
					);

					if (matchingStickers.size > 0) {
						return matchingStickers
							.sort((a, b) => {
								const aTime = a.createdTimestamp ?? 0;
								const bTime = b.createdTimestamp ?? 0;
								if (aTime !== bTime) return bTime - aTime;
								return a.id.localeCompare(b.id);
							})
							.first();
					}
				} else {
					// Legacy path: select by sticker ID
					return guild.stickers.cache.get(stickerId) ?? null;
				}
				return null;
			};

			// 1. First attempt: lookup in current cache
			let selectedSticker = lookupSticker();

			// 2. If not found, fetch fresh from Discord API and retry (handles race conditions)
			if (!selectedSticker) {
				log.info(
					`Sticker '${normalizedStickerName || stickerId}' not in cache. Fetching fresh from Discord API...`,
				);

				try {
					// Refresh cache from Discord API
					await guild.stickers.fetch();
					log.info("Sticker cache refreshed from Discord API");

					// Retry lookup with refreshed cache
					selectedSticker = lookupSticker();

					if (selectedSticker) {
						log.success(
							`Sticker '${selectedSticker.name}' (${selectedSticker.id}) found after cache refresh`,
						);
					}
				} catch (fetchError) {
					log.warn(
						`Failed to refresh sticker cache from Discord API: ${(fetchError as Error).message}`,
					);
					// Continue to "not found" logic below
				}
			} else {
				log.success(
					`Sticker '${selectedSticker.name}' (${selectedSticker.id}) found in local cache`,
				);
			}

			// 3. Success case - sticker found
			if (selectedSticker) {
				return {
					success: true,
					message: "Sticker selected successfully",
					data: {
						// Return format matching tomoriChat.ts functionExecutionResult
						status: "sticker_selected_successfully",
						sticker_id: selectedSticker.id,
						sticker_name: selectedSticker.name,
						sticker_description:
							selectedSticker.description || "No description available",
						// Additional data for compatibility
						sticker: selectedSticker,
					},
				};
			}

			// 4. Sticker not found even after refresh - inform LLM
			log.warn(
				`Sticker '${normalizedStickerName || stickerId}' not found even after cache refresh. Sticker does not exist.`,
			);

			// Get available stickers for error message
			const availableStickers = guild.stickers.cache;
			const availableStickerData = availableStickers
				.map((sticker) => ({
					name: sticker.name,
					description: sticker.description || "No description available",
				}))
				.slice(0, 10); // Limit to prevent overwhelming the LLM

			const notFoundMessage = normalizedStickerName
				? "The sticker name provided was not found among the available server stickers. Please choose from the provided list or do not use a sticker."
				: "The sticker ID provided was not found among the available server stickers. Please choose by name from the provided list or do not use a sticker.";

			return {
				success: false,
				error: "Sticker not found",
				message: notFoundMessage,
				data: {
					// Return format matching tomoriChat.ts functionExecutionResult
					status: "sticker_not_found",
					sticker_name_attempted: normalizedStickerName || undefined,
					sticker_id_attempted: !normalizedStickerName ? stickerId : undefined,
					reason: notFoundMessage,
					availableStickers: availableStickerData,
				},
			};
		} catch (error) {
			log.error(
				`Sticker selection failed for: ${normalizedStickerName || stickerId}`,
				error as Error,
			);

			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Unknown error occurred during sticker selection",
				message:
					"Failed to select the requested sticker. Please try with a different sticker.",
				data: {
					status: "sticker_selection_failed_error",
					reason: error instanceof Error ? error.message : "Unknown error",
				},
			};
		}
	}

	/**
	 * Get available stickers for context building
	 * This helper method can be used to provide sticker options to the LLM
	 * @param context - Tool context
	 * @returns Array of available sticker information
	 */
	static getAvailableStickers(context: ToolContext): Array<{
		id: string;
		name: string;
		description: string;
	}> {
		try {
			// Return empty array for DM channels - no stickers available
			if (!("guild" in context.channel)) {
				return [];
			}

			const guild = context.channel.guild;
			const availableStickers = guild.stickers.cache;

			return availableStickers
				.map((sticker) => ({
					id: sticker.id,
					name: sticker.name,
					description: sticker.description || "No description available",
				}))
				.slice(0, 20); // Limit to prevent context bloat
		} catch (error) {
			log.warn(
				`Failed to get available stickers for context: ${(error as Error).message}`,
			);
			return [];
		}
	}
}
