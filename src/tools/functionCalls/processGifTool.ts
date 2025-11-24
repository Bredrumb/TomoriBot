/**
 * GIF Processing Tool (Development Only)
 * Allows the AI to selectively process GIF attachments on-demand by extracting keyframes
 * This is disabled in production to prevent memory exhaustion (100-130 MB per GIF)
 */

import { log } from "@/utils/misc/logger";
import { GUARDS_ENABLED, MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { extractGifKeyframes } from "@/utils/media/gifProcessor";
import {
	BaseTool,
	type ToolContext,
	type ToolResult,
	type ToolParameterSchema,
} from "@/types/tool/interfaces";
import {
	ContextItemTag,
	type StructuredContextItem,
} from "@/types/misc/context";

/**
 * Tool for processing GIF attachments on-demand in development environments
 * Extracts keyframes from GIFs and injects them into conversation context
 *
 * IMPORTANT: This tool is ONLY available in development (when GUARDS_ENABLED = false)
 * Production environments use text placeholders instead to prevent OOM crashes
 */
export class ProcessGifTool extends BaseTool {
	/**
	 * Static storage for enhanced context items to avoid serializing base64 in tool responses
	 * Key: message ID, Value: StructuredContextItem with processed GIF frames
	 */
	static pendingEnhancedContextItems = new Map<
		string,
		StructuredContextItem
	>();

	name = "process_gif";
	description =
		"Extract and analyze keyframes from a GIF attachment in a Discord message. DEV ONLY - memory intensive (100-130 MB per GIF). Use sparingly when GIF context is truly needed for understanding the conversation.";
	category = "utility" as const;

	parameters: ToolParameterSchema = {
		type: "object",
		properties: {
			message_id: {
				type: "string",
				description:
					"Discord message ID containing the GIF attachment to process. This message must be within the last 100 messages in the channel.",
			},
			reason: {
				type: "string",
				description:
					"Optional brief explanation of why you need to process this GIF. Helps with debugging and understanding AI decision-making.",
			},
		},
		required: ["message_id"],
	};

	/**
	 * Check if GIF processing tool is available for the given provider
	 * Only available in development (GUARDS_ENABLED = false)
	 *
	 * @param _provider - LLM provider name (unused - availability based on model capabilities and environment)
	 * @returns True only if not in production (actual model check happens in isAvailableForContext)
	 */
	isAvailableFor(_provider: string): boolean {
		// Block in production to prevent memory exhaustion
		if (GUARDS_ENABLED) {
			log.info(
				"ProcessGifTool: Blocked in production mode (GUARDS_ENABLED = true)",
			);
			return false;
		}

		// Provider-agnostic, but requires vision capability check in isAvailableForContext
		return true;
	}

	/**
	 * Enhanced availability check that considers context flags and model vision capabilities
	 *
	 * @param provider - LLM provider name
	 * @param context - Tool context that may contain disable flags and tomoriState
	 * @returns True if tool should be available
	 */
	isAvailableForContext(provider: string, context?: ToolContext): boolean {
		// Base provider and environment check
		if (!this.isAvailableFor(provider)) {
			return false;
		}

		// Require context with tomoriState
		if (!context?.tomoriState) {
			log.warn(
				"ProcessGifTool: No tomoriState in context, defaulting to unavailable",
			);
			return false;
		}

		// Check if model has vision capabilities (GIFs require vision)
		const hasVision = context.tomoriState.llm.sees_images;

		if (!hasVision) {
			log.info(
				`ProcessGifTool: Model ${context.tomoriState.llm.llm_codename} does not support vision (sees_images=false). Tool disabled.`,
			);
			return false;
		}

		// Check for GIF processing disable flag during enhanced context restart
		if (context?.streamContext?.disableGifProcessing) {
			log.info(
				"ProcessGifTool: Temporarily disabled during enhanced context restart",
			);
			return false;
		}

		return true;
	}

	/**
	 * Execute GIF processing
	 *
	 * Algorithm:
	 * 1. Validate parameters (message_id is required)
	 * 2. Fetch recent messages from channel (last 100)
	 * 3. Find target message by ID
	 * 4. Extract GIF attachment from message
	 * 5. Validate GIF size via HEAD request (reject if > 50 MB)
	 * 6. Process GIF using extractGifKeyframes() utility
	 * 7. Create StructuredContextItem with processed frames
	 * 8. Store in static map for enhanced context restart
	 * 9. Return success signal to trigger context restart
	 *
	 * @param args - Arguments containing message_id and optional reason
	 * @param context - Tool execution context with Discord client access
	 * @returns Promise resolving to tool result with restart signal
	 */
	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		// 1. Extract and validate parameters
		const messageId = args.message_id as string;
		const reason = (args.reason as string | undefined) || "No reason provided";

		if (!messageId) {
			log.warn("ProcessGifTool: Missing required parameter 'message_id'");
			return {
				success: false,
				error: "Missing required parameter: message_id",
				message:
					"I need a message ID to process a GIF. Please provide the message ID containing the GIF.",
			};
		}

		log.info(
			`ProcessGifTool: Starting GIF processing for message ${messageId} - Reason: ${reason}`,
		);

		try {
			// 2. Fetch recent messages from the channel (last 100)
			log.info(
				`ProcessGifTool: Fetching recent messages from channel ${context.channel.id}`,
			);
			const recentMessages = await context.channel.messages.fetch({
				limit: 100,
			});

			// 3. Find the target message by ID
			const targetMessage = recentMessages.get(messageId);
			if (!targetMessage) {
				log.warn(
					`ProcessGifTool: Message ${messageId} not found in recent 100 messages`,
				);
				return {
					success: false,
					error: "Message not found",
					message:
						"I couldn't find that message in the recent conversation (last 100 messages). The message might be too old or the ID might be incorrect.",
					data: {
						status: "message_not_found",
						message_id: messageId,
					},
				};
			}

			// 4. Extract GIF attachment from message
			log.info(
				`ProcessGifTool: Found message ${messageId}, checking for GIF attachments (${targetMessage.attachments.size} total attachments)`,
			);

			let gifAttachment: { url: string; size: number } | null = null;
			for (const attachment of targetMessage.attachments.values()) {
				if (attachment.contentType?.startsWith("image/gif")) {
					gifAttachment = {
						url: attachment.url,
						size: attachment.size,
					};
					log.info(
						`ProcessGifTool: Found GIF attachment - URL: ${attachment.url}, Size: ${attachment.size} bytes`,
					);
					break;
				}
			}

			if (!gifAttachment) {
				log.warn(
					`ProcessGifTool: No GIF attachment found in message ${messageId}`,
				);
				return {
					success: false,
					error: "No GIF found",
					message:
						"That message doesn't contain a GIF attachment. Please provide a message ID with a GIF.",
					data: {
						status: "no_gif_found",
						message_id: messageId,
					},
				};
			}

			// 5. Validate GIF size (reject if > MAX_GIF_SIZE_MB)
			const maxSizeBytes = MEDIA_LIMITS.MAX_GIF_SIZE_MB * 1024 * 1024;
			if (gifAttachment.size > maxSizeBytes) {
				const sizeMB = (gifAttachment.size / (1024 * 1024)).toFixed(2);
				log.warn(
					`ProcessGifTool: GIF too large (${sizeMB} MB > ${MEDIA_LIMITS.MAX_GIF_SIZE_MB} MB)`,
				);
				return {
					success: false,
					error: "GIF too large",
					message: `That GIF is too large to process (${sizeMB} MB). Maximum size is ${MEDIA_LIMITS.MAX_GIF_SIZE_MB} MB.`,
					data: {
						status: "gif_too_large",
						message_id: messageId,
						size_mb: Number.parseFloat(sizeMB),
						max_size_mb: MEDIA_LIMITS.MAX_GIF_SIZE_MB,
					},
				};
			}

			// 6. Process GIF using extractGifKeyframes() utility
			log.info(
				`ProcessGifTool: Processing GIF from ${gifAttachment.url} (${(gifAttachment.size / 1024).toFixed(2)} KB)`,
			);
			const startTime = Date.now();
			const processedFrames = await extractGifKeyframes(gifAttachment.url);
			const processingTime = Date.now() - startTime;

			log.success(
				`ProcessGifTool: Extracted ${processedFrames.length} keyframes in ${processingTime}ms`,
			);

			// 7. Create StructuredContextItem with processed frames
			// Include both standard ContextPart fields AND inlineData for Gemini provider
			type GifFramePart =
				| { type: "text"; text: string }
				| {
						type: "image";
						uri: string;
						mimeType: string;
						inlineData: { mimeType: string; data: string };
				  };

			const frameParts: GifFramePart[] = [];

			// Add initial text label for the GIF
			frameParts.push({
				type: "text",
				text: `[Animated GIF from message ${messageId} - ${processedFrames.length} keyframes extracted from ${processedFrames[0].totalFrames} total frames]`,
			});

			// Add each keyframe with a label (matching googleStreamAdapter pattern)
			for (const frame of processedFrames) {
				// Add frame label
				frameParts.push({
					type: "text",
					text: `Frame ${frame.frameNumber + 1}/${processedFrames.length} (original frame ${frame.originalFrameIndex + 1}/${frame.totalFrames}):`,
				});

				// Add frame image data with both standard fields and inlineData
				frameParts.push({
					type: "image",
					uri: `data:${frame.mimeType};base64,${frame.data}`,
					mimeType: frame.mimeType,
					inlineData: {
						mimeType: frame.mimeType,
						data: frame.data,
					},
				});
			}

			const enhancedContextItem: StructuredContextItem = {
				role: "user",
				metadataTag: ContextItemTag.DIALOGUE_HISTORY, // Inject into conversation, not system instruction
				parts: frameParts,
			};

			// 8. Store in static map for enhanced context restart
			ProcessGifTool.pendingEnhancedContextItems.set(
				messageId,
				enhancedContextItem,
			);
			log.info(
				`ProcessGifTool: Stored ${processedFrames.length} frames in pending context map for message ${messageId}`,
			);

			// 9. Return success signal to trigger context restart
			return {
				success: true,
				message: `Successfully processed GIF with ${processedFrames.length} keyframes from message ${messageId}. Processing took ${processingTime}ms.`,
				data: {
					type: "context_restart_with_gif",
					message_id: messageId,
					frame_count: processedFrames.length,
					processing_time_ms: processingTime,
					has_pending_context: true,
					reason: reason,
				},
			};
		} catch (error) {
			// Comprehensive error handling with categorization
			log.error(
				`ProcessGifTool: Failed to process GIF for message ${messageId}`,
				error as Error,
			);

			let errorMessage = "Failed to process GIF due to an unexpected error.";
			let errorStatus = "gif_processing_failed";

			if (error instanceof Error) {
				// Categorize errors for better UX
				if (error.message.includes("timeout")) {
					errorMessage =
						"GIF processing timed out (exceeded 30 seconds). The GIF might be too complex or too large.";
					errorStatus = "processing_timeout";
				} else if (error.message.includes("fetch")) {
					errorMessage =
						"Failed to download the GIF. The URL might be invalid or expired.";
					errorStatus = "fetch_failed";
				} else if (error.message.includes("parse")) {
					errorMessage =
						"Failed to parse the GIF file. The file might be corrupted or in an unsupported format.";
					errorStatus = "parse_failed";
				} else {
					// Include error message for debugging
					errorMessage = `Failed to process GIF: ${error.message}`;
				}
			}

			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
				message: errorMessage,
				data: {
					status: errorStatus,
					message_id: messageId,
					reason: reason,
				},
			};
		}
	}

	/**
	 * Retrieve and remove pending enhanced context for a message
	 * @param messageId - Discord message ID containing the GIF
	 * @returns Enhanced context item if found, undefined otherwise
	 */
	static getPendingEnhancedContext(
		messageId: string,
	): StructuredContextItem | undefined {
		const contextItem =
			ProcessGifTool.pendingEnhancedContextItems.get(messageId);
		if (contextItem) {
			// Remove from map to prevent memory leaks
			ProcessGifTool.pendingEnhancedContextItems.delete(messageId);
		}
		return contextItem;
	}

	/**
	 * Check if a message has pending enhanced context
	 * @param messageId - Message ID to check
	 * @returns True if message has pending enhanced context
	 */
	static hasPendingEnhancedContext(messageId: string): boolean {
		return ProcessGifTool.pendingEnhancedContextItems.has(messageId);
	}

	/**
	 * Clear all pending enhanced context items (for cleanup)
	 */
	static clearAllPendingEnhancedContext(): void {
		ProcessGifTool.pendingEnhancedContextItems.clear();
	}
}
