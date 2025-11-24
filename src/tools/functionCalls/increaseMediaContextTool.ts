/**
 * Media Context Expansion Tool
 * Allows the AI to request additional media from older messages that were windowed out
 * This tool signals tomoriChat.ts to rebuild context with an expanded media window
 *
 * IMPORTANT: This tool does NOT handle the actual expansion logic.
 * It only validates parameters and returns a restart signal.
 * The actual expansion happens in tomoriChat.ts which already has access to
 * the mushed message turns and can call buildContext() with an expanded window.
 */

import { log } from "@/utils/misc/logger";
import { memoryGuard, MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import {
	BaseTool,
	type ToolContext,
	type ToolResult,
	type ToolParameterSchema,
} from "@/types/tool/interfaces";

/**
 * Tool for expanding media context window to view media from older messages
 * Works with all LLM providers that support vision (sees_images = true)
 *
 * Use case: AI sees placeholder like "[This message contained 2 images - use increase_media_context with extend_by=15 to view]"
 * and can request to see those images by calling this tool
 */
export class IncreaseMediaContextTool extends BaseTool {

	name = "increase_media_context";
	description =
		"Expand the media context window to view images and videos from older messages that were hidden for optimization. Use when you see placeholders indicating hidden media. The placeholder text tells you the exact extend_by value needed.";
	category = "utility" as const;

	parameters: ToolParameterSchema = {
		type: "object",
		properties: {
			extend_by: {
				type: "number",
				description:
					"Number of additional older messages to include with full media. The placeholder text shows the exact value needed (e.g., 'extend_by=15'). Default: 10, Max: calculated dynamically as MESSAGE_FETCH_LIMIT - current window.",
			},
		},
		required: [],
	};

	/**
	 * Check if media context expansion is available for the given provider
	 * Only available for vision-capable models (sees_images = true)
	 *
	 * @param _provider - LLM provider name (unused - availability based on model capabilities)
	 * @returns True for all providers (actual check happens in isAvailableForContext)
	 */
	isAvailableFor(_provider: string): boolean {
		// Provider-agnostic, but requires vision capability check in isAvailableForContext
		return true;
	}

	/**
	 * Enhanced availability check that considers model vision capabilities
	 *
	 * @param provider - LLM provider name
	 * @param context - Tool context containing tomoriState with LLM info
	 * @returns True only if model has vision capabilities (sees_images = true)
	 */
	isAvailableForContext(provider: string, context?: ToolContext): boolean {
		// Base provider check
		if (!this.isAvailableFor(provider)) {
			return false;
		}

		// Require context with tomoriState
		if (!context?.tomoriState) {
			log.warn(
				"IncreaseMediaContextTool: No tomoriState in context, defaulting to unavailable",
			);
			return false;
		}

		// Check if model has vision capabilities
		const hasVision = context.tomoriState.llm.sees_images;

		if (!hasVision) {
			log.info(
				`IncreaseMediaContextTool: Model ${context.tomoriState.llm.llm_codename} does not support vision (sees_images=false). Tool disabled.`,
			);
			return false;
		}

		return true;
	}

	/**
	 * Execute media context expansion
	 *
	 * Algorithm:
	 * 1. Validate and parse extend_by parameter (default 10)
	 * 2. Calculate maximum allowed extend_by based on current window
	 * 3. Check memory status via memoryGuard
	 * 4. Return restart signal for tomoriChat.ts to handle actual expansion
	 *
	 * @param args - Arguments containing optional extend_by parameter
	 * @param context - Tool execution context (used for validation)
	 * @returns Promise resolving to tool result with restart signal
	 */
	async execute(
		args: Record<string, unknown>,
		_context: ToolContext,
	): Promise<ToolResult> {
		// 1. Extract and validate parameters
		const extendBy = (args.extend_by as number | undefined) ?? 10; // Default 10 if not provided

		// 2. Calculate maximum allowed extend_by
		const currentMediaWindow = memoryGuard.getMediaWindow();
		const maxExtendBy =
			MEDIA_LIMITS.MESSAGE_FETCH_LIMIT - currentMediaWindow;

		if (typeof extendBy !== "number" || extendBy < 1) {
			log.warn(
				`IncreaseMediaContextTool: Invalid extend_by value: ${extendBy}`,
			);
			return {
				success: false,
				error: "Invalid parameter",
				message:
					"extend_by must be a positive number (minimum 1). Example: extend_by=10",
			};
		}

		if (extendBy > maxExtendBy) {
			log.warn(
				`IncreaseMediaContextTool: extend_by=${extendBy} exceeds maximum ${maxExtendBy}`,
			);
			return {
				success: false,
				error: "Parameter out of range",
				message: `extend_by=${extendBy} exceeds maximum allowed value of ${maxExtendBy}. The current media window is ${currentMediaWindow} messages, and we've only fetched ${MEDIA_LIMITS.MESSAGE_FETCH_LIMIT} total messages.`,
				data: {
					requested: extendBy,
					maximum: maxExtendBy,
					current_window: currentMediaWindow,
					total_messages: MEDIA_LIMITS.MESSAGE_FETCH_LIMIT,
				},
			};
		}

		// 3. Check memory status
		const memoryStatus = memoryGuard.checkMemory();
		if (memoryStatus.status === "critical") {
			log.warn(
				"IncreaseMediaContextTool: Blocked due to critical memory pressure",
			);
			return {
				success: false,
				error: "Memory pressure",
				message:
					"Cannot expand media context right now due to high memory usage. Please try again in a moment.",
				data: {
					memory_status: memoryStatus.status,
					memory_used_mb: memoryStatus.heapUsedMB,
					memory_limit_mb: memoryStatus.heapLimitMB,
				},
			};
		}

		log.info(
			`IncreaseMediaContextTool: Validated request to expand media window by ${extendBy} messages. Signaling context restart.`,
		);

		// 4. Return restart signal for tomoriChat.ts to handle
		// tomoriChat.ts will call buildContext() again with mediaContextWindow parameter
		return {
			success: true,
			message: `Expanding media context window by ${extendBy} messages to reveal previously hidden images and videos.`,
			data: {
				type: "context_restart_with_media",
				extend_by: extendBy,
				old_window: currentMediaWindow,
				new_window: currentMediaWindow + extendBy,
			},
		};
	}
}
