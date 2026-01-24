import type {
	AnyThreadChannel,
	BaseGuildVoiceChannel,
	Client,
	Message,
	Sticker,
	Embed,
	Webhook,
} from "discord.js";
import {
	BaseGuildTextChannel,
	ChannelType,
	DMChannel,
	TextChannel,
} from "discord.js"; // Import value for instanceof check
// Provider imports moved to factory pattern
import type {
	StructuredContextItem,
	RequestSnapshot,
} from "../../types/misc/context";
import { ContextItemTag } from "../../types/misc/context";
// Provider-specific types moved to individual providers
import type { FunctionCall } from "../../types/provider/interfaces";
import { getCachedAllPersonas } from "../../utils/cache/tomoriStateCache";
import {
	getCachedUserRow,
	getCachedPrivacyLevel,
	getCachedBlacklistStatus,
} from "../../utils/cache/userCache";
import { incrementTomoriCounter } from "@/utils/db/dbWrite";
import {
	createStandardEmbed,
	sendStandardEmbed,
} from "../../utils/discord/embedHelper";
import { StreamOrchestrator } from "../../utils/discord/streamOrchestrator";
import {
	getOrCreateWebhook,
	getOrCreatePersonaWebhook,
	resolvePersonaAvatarURL,
	type WebhookCreateErrorReason,
} from "../../utils/discord/webhookManager";
import { ColorCode, log } from "../../utils/misc/logger";
import { buildContext } from "../../utils/text/contextBuilder";
import { applyEmojiPenaltyIfNeeded } from "../../utils/text/emojiPenalty";
import {
	removeYouTubeUrls,
	extractYouTubeVideoIds,
} from "../../utils/text/youTubeUrlCleaner";
import { resolveTenorUrl } from "../../utils/media/tenorResolver";
import { PeekProfilePictureTool } from "../../tools/functionCalls/peekProfilePictureTool";
import { ProcessGifTool } from "../../tools/functionCalls/processGifTool";
import { decryptApiKey } from "@/utils/security/crypto";
import {
	selectApiKey,
	recordKeySuccess,
	recordKeyError,
	type SelectedKeyResult,
} from "@/utils/security/keyRotation";
import { localizer, getSupportedLocales } from "../../utils/text/localizer";
import { escapeRegExp } from "../../utils/text/stringHelper";
import { sql } from "@/utils/db/client";
import { loadEmojiStickerCache } from "../../utils/cache/emojiStickerCache";

import type {
	TomoriState,
	ServerEmojiRow,
	ServerStickerRow,
} from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
// Provider-specific function declarations moved to providers
import { getProviderForTomori } from "../../utils/provider/providerFactory";
import type {
	LLMProvider,
	StreamResult,
} from "../../types/provider/interfaces";
import { ToolRegistry } from "../../tools/toolRegistry";
import { keyManager } from "@/utils/security/keyManager";
import {
	checkUserRateLimit,
	checkServerRateLimit,
} from "@/utils/security/rateLimiter";
import {
	checkMessageTriggerCooldown,
	setMessageTriggerCooldown,
	getCooldownTypeFooterKey,
} from "@/utils/db/messageCooldown";
import { CooldownType } from "@/types/db/schema";

// Constants
const MESSAGE_FETCH_LIMIT = Number.parseInt(
	process.env.MESSAGE_FETCH_LIMIT || "80",
	10,
);

// Base trigger words that will always work (with or without spaces for English)
const BASE_TRIGGER_WORDS = process.env.BASE_TRIGGER_WORDS?.split(",").map(
	(word) => word.trim(),
) || ["tomori", "tomo", "トモリ", "ともり"];

const IS_PRODUCTION = process.env.RUN_ENV === "production";
const WEBHOOK_ERROR_COOLDOWN_MS = 10 * 60 * 1000;
const webhookErrorCooldowns = new Map<string, number>();

const MAX_FUNCTION_CALL_ITERATIONS = 8; // Safety break for function call loops
const STREAM_SDK_CALL_TIMEOUT_MS = 35000; // Slightly longer than internal stream inactivity, 35 seconds

function shouldSendWebhookError(channelId: string): boolean {
	const now = Date.now();
	const lastSent = webhookErrorCooldowns.get(channelId) ?? 0;

	if (now - lastSent < WEBHOOK_ERROR_COOLDOWN_MS) {
		return false;
	}

	webhookErrorCooldowns.set(channelId, now);
	return true;
}

async function sendWebhookErrorEmbed(
	channel: BaseGuildTextChannel | AnyThreadChannel,
	locale: string,
	reason: WebhookCreateErrorReason,
): Promise<void> {
	if (!shouldSendWebhookError(channel.id)) {
		return;
	}

	const titleKey =
		reason === "missing_permissions"
			? "general.errors.webhook_missing_permissions_title"
			: reason === "max_webhooks"
				? "general.errors.webhook_limit_title"
				: "general.errors.webhook_unknown_error_title";
	const descriptionKey =
		reason === "missing_permissions"
			? "general.errors.webhook_missing_permissions_description"
			: reason === "max_webhooks"
				? "general.errors.webhook_limit_description"
				: "general.errors.webhook_unknown_error_description";

	await sendStandardEmbed(channel, locale, {
		color: ColorCode.WARN,
		titleKey,
		descriptionKey,
	});
}

/**
 * Creates comprehensive natural stop patterns for graceful stream interruption
 * Organized by category for easy maintenance and expansion
 * @returns Array of RegExp patterns for stop detection
 */
function createNaturalStopPatterns(): RegExp[] {
	// 1. Basic stop commands (single words with word boundaries)
	const basicStops = [
		"wait",
		"stop",
		"enough",
		"chill",
		"halt",
		"pause",
		"quit",
	];

	// 2. Polite stop phrases (with contextual words)
	const politeStops = [
		"okay\\s+(stop|enough)",
		"that's\\s+(enough|good|fine)",
		"alright\\s+stop",
		"please\\s+stop",
	];

	// 3. Dismissive phrases
	const dismissive = [
		"nevermind",
		"never\\s*mind",
		"cut\\s+it\\s+out",
		"tone\\s+it\\s+down",
		"knock\\s+it\\s+off",
	];

	// 4. Japanese stop patterns (common ways to say stop/enough in Japanese)
	const japanese = [
		"やめて", // yamete - stop it
		"ストップ", // sutoppu - stop (katakana)
		"もういい", // mou ii - that's enough
		"十分", // juubun - enough/sufficient
		"もう十分", // mou juubun - that's enough
		"いいよ", // ii yo - that's fine/enough
		"もうやめて", // mou yamete - stop it already
		"待って", // matte - wait
		"ちょっと待って", // chotto matte - wait a moment
	];

	// 5. Create regex patterns
	const patterns: RegExp[] = [];

	// Basic stops with word boundaries
	for (const stop of basicStops) {
		patterns.push(new RegExp(`\\b${stop}\\b`, "i"));
	}

	// Polite stops (already have proper spacing patterns)
	for (const polite of politeStops) {
		patterns.push(new RegExp(polite, "i"));
	}

	// Dismissive phrases with word boundaries where appropriate
	for (const dismiss of dismissive) {
		patterns.push(new RegExp(`\\b${dismiss}\\b`, "i"));
	}

	// Japanese patterns (no word boundaries needed for Japanese text)
	for (const jp of japanese) {
		patterns.push(new RegExp(jp, "i"));
	}

	return patterns;
}

// Generate stop patterns once at module load
const NATURAL_STOP_PATTERNS = createNaturalStopPatterns();

// YouTube URL detection patterns for video analysis
const YOUTUBE_URL_PATTERNS = [
	/(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/i,
	/(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
	/(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i,
	/(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i, // YouTube Shorts support
];

// Supported video MIME types for direct video uploads (following Gemini API documentation)
const SUPPORTED_VIDEO_MIME_TYPES = [
	"video/mp4",
	"video/mpeg",
	"video/mov",
	"video/avi",
	"video/x-flv",
	"video/mpg",
	"video/webm",
	"video/wmv",
	"video/3gpp",
];

// Regex to detect Tenor GIF URLs anywhere in the message content
// Includes % for URL-encoded characters (e.g., Japanese characters in slugs)
const TENOR_GIF_REGEX =
	/(https?:\/\/)?(www\.)?tenor\.com\/view\/[a-zA-Z0-9%-]+-gif-\d+(\?.*)?/gi;

// Define a type for our simplified message structure.
// This will be passed to buildContext, which will then convert it into StructuredContextItem[].
// Rule 13: This type is local to this file's processing logic for now.
// If it becomes shared across multiple files for context building, we can move it to /types/.
type SimplifiedMessageForContext = {
	id: string; // Discord message ID
	authorId: string;
	authorName: string; // Resolved name (Tomori's nickname or user's display name)
	authorType: "user" | "persona"; // Whether this message is from a user or a persona
	personaName?: string | null; // Persona nickname if authorType is "persona"
	content: string | null; // Message text content
	mediaSourceMessageId?: string; // Message ID that actually hosts the media, if different
	imageAttachments: Array<{
		url: string; // Original URL of the image
		proxyUrl: string; // Discord's proxy URL, often more stable for fetching
		mimeType: string | null; // e.g., 'image/png', 'image/jpeg'
		filename: string; // Original filename
		isEmoji?: boolean; // True if this attachment is a custom Discord emoji
	}>;
	videoAttachments: Array<{
		url: string; // Original URL of the video
		proxyUrl: string; // Discord's proxy URL, often more stable for fetching
		mimeType: string | null; // e.g., 'video/mp4', 'video/webm', or 'video/youtube' for YouTube links
		filename: string; // Original filename or generated name for YouTube videos
		isYouTubeLink: boolean; // True if this is a YouTube URL, false for direct video uploads
	}>;
	// Future consideration: user-sent stickers
	// stickerAttachments: Array<{ name: string; id: string; formatType: StickerFormatType }>;
};

function buildEmojiCdnUrl(emojiId: string): string {
	// Always use PNG so animated emojis fall back to their first frame.
	return `https://cdn.discordapp.com/emojis/${emojiId}.png`;
}

function extractEmojiImageAttachments(
	content: string,
): SimplifiedMessageForContext["imageAttachments"] {
	const attachments: SimplifiedMessageForContext["imageAttachments"] = [];
	if (!content) return attachments;

	const emojiPattern = /<(a?):([^:]+):(\d{17,20})>/g;
	const seenEmojiIds = new Set<string>();
	let match: RegExpExecArray | null;

	// biome-ignore lint/suspicious/noAssignInExpressions: Separate match assignment from null check
	while ((match = emojiPattern.exec(content)) !== null) {
		const emojiName = match[2];
		const emojiId = match[3];

		if (seenEmojiIds.has(emojiId)) {
			continue;
		}

		seenEmojiIds.add(emojiId);
		const emojiUrl = buildEmojiCdnUrl(emojiId);

		attachments.push({
			url: emojiUrl,
			proxyUrl: emojiUrl,
			mimeType: "image/png",
			filename: `emoji_${emojiName}_${emojiId}.png`,
			isEmoji: true,
		});
	}

	return attachments;
}

// New: Constants for the semaphore/locking mechanism
const CHANNEL_LOCK_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for a lock to be considered stale

// New: In-memory store for channel locks and message queues
interface ChannelLockEntry {
	isLocked: boolean;
	lockedAt: number; // Timestamp when the lock was acquired
	currentMessageId?: string; // Discord ID of the message currently being processed
	serverDiscId: string; // Server/DM channel Discord ID for rate limiting
	userDiscId?: string; // Discord ID of user whose message is currently being processed
	currentIsPersonaJob?: boolean; // Skip user rate limits for internal persona jobs
	messageQueue: Array<{
		message: Message;
		isManuallyTriggered?: boolean;
		forceReason?: boolean;
		reasoningQuery?: string; // Query to inject as system message for reasoning mode
		llmOverrideCodename?: string;
		isStopResponse?: boolean; // Flag to prevent stopping stop responses
		selectedPersonaId?: number;
		isPersonaJob?: boolean;
	}>;
}
const channelLocks = new Map<string, ChannelLockEntry>(); // Key: channel.id

/**
 * Checks if a message contains natural stop patterns
 * @param content - The message content to check
 * @returns True if the message contains stop patterns
 */
function isNaturalStopMessage(content: string): boolean {
	if (!content?.trim()) return false;
	return NATURAL_STOP_PATTERNS.some((pattern) =>
		pattern.test(content.toLowerCase()),
	);
}

/**
 * Counts the total number of active messages (processing + queued) for a specific user across all servers.
 * This is used for user-level rate limiting to prevent abuse.
 * @param userDiscId - The Discord user ID to count messages for
 * @returns The total count of active messages for this user
 */
function getUserActiveMessageCount(userDiscId: string): number {
	let count = 0;

	// Iterate through all channel locks
	for (const lockEntry of channelLocks.values()) {
		// 1. Count if user's message is currently being processed
		if (
			lockEntry.isLocked &&
			lockEntry.userDiscId === userDiscId &&
			!lockEntry.currentIsPersonaJob
		) {
			count++;
		}

		// 2. Count queued messages from this user
		count += lockEntry.messageQueue.filter(
			(queuedMsg) =>
				queuedMsg.message.author.id === userDiscId && !queuedMsg.isPersonaJob,
		).length;
	}

	return count;
}

/**
 * Counts the total number of active messages (processing + queued) for a specific server across all channels.
 * This is used for server-level rate limiting to prevent overload.
 * @param serverDiscId - The Discord server ID (or DM channel ID) to count messages for
 * @returns The total count of active messages for this server
 */
function getServerActiveMessageCount(serverDiscId: string): number {
	let count = 0;

	// Iterate through all channel locks
	for (const lockEntry of channelLocks.values()) {
		// Only process channels belonging to this server
		if (lockEntry.serverDiscId === serverDiscId) {
			// 1. Count if a message is currently being processed
			if (lockEntry.isLocked) {
				count++;
			}

			// 2. Count all queued messages in this channel
			count += lockEntry.messageQueue.length;
		}
	}

	return count;
}

/**
 * Sends a DM to a user notifying them that they have exceeded the rate limit.
 * Handles cases where the user has blocked DMs or the bot cannot send DMs.
 * @param userDiscId - The Discord user ID to send the DM to
 * @param client - The Discord client instance
 * @param userLocale - The user's preferred locale for the message
 * @param currentCount - The current number of active messages for this user
 */
async function sendUserRateLimitDM(
	userDiscId: string,
	client: Client,
	userLocale: string,
	currentCount: number,
): Promise<void> {
	try {
		// Fetch the user
		const user = await client.users.fetch(userDiscId);

		// Create the rate limit embed
		const rateLimitEmbed = createStandardEmbed(userLocale, {
			titleKey: "rate_limit.user_exceeded_title",
			descriptionKey: "rate_limit.user_exceeded_description",
			color: ColorCode.WARN,
		});

		// Send the DM
		await user.send({ embeds: [rateLimitEmbed] });
		log.info(
			`Sent rate limit DM to user ${userDiscId} (${currentCount} active messages)`,
		);
	} catch (error) {
		// User likely has DMs disabled or blocked the bot - this is expected, log as info not error
		log.info(
			`Could not send rate limit DM to user ${userDiscId}: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Sends a public embed in the channel notifying that the server has exceeded the rate limit.
 * Suggests using DMs or other servers as alternatives.
 * @param channel - The Discord channel to send the embed to
 * @param locale - The server's preferred locale for the message
 * @param currentCount - The current number of active messages for this server
 */
async function sendServerRateLimitEmbed(
	channel:
		| TextChannel
		| DMChannel
		| BaseGuildTextChannel
		| AnyThreadChannel
		| BaseGuildVoiceChannel,
	locale: string,
	currentCount: number,
): Promise<void> {
	try {
		await sendStandardEmbed(channel, locale, {
			titleKey: "rate_limit.server_exceeded_title",
			descriptionKey: "rate_limit.server_exceeded_description",
			color: ColorCode.WARN,
		});
		log.info(
			`Sent rate limit embed to channel ${channel.id} (${currentCount} active messages in server)`,
		);
	} catch (error) {
		log.warn(`Failed to send rate limit embed to channel ${channel.id}`, error);
	}
}

/**
 * Handles incoming messages to potentially generate a response using genai.
 * @param client - The Discord client instance.
 * @param message - The incoming Discord message.
 * @param isFromQueue - Whether this message is being processed from the queue.
 * @param isManuallyTriggered - Whether this call is triggered by a manual command.
 * @param forceReason - Whether to use reasoning mode for this response.
 * @param reasoningQuery - Query to inject as system message for reasoning mode.
 * @param llmOverrideCodename - Override LLM model codename to use instead of server default.
 * @param isStopResponse - Whether this is a stop response (cannot be stopped).
 * @param retryCount - Number of retry attempts for empty responses (internal use).
 * @param skipLock - Whether to skip semaphore lock acquisition (for recursive calls).
 * @param selectedPersonaId - Optional persona ID to use instead of main persona (for manual triggers).
 * @param isPersonaJob - Whether this invocation is an internal queued persona job.
 */
export default async function tomoriChat(
	client: Client,
	message: Message,
	isFromQueue: boolean,
	isManuallyTriggered?: boolean,
	forceReason?: boolean,
	reasoningQuery?: string,
	llmOverrideCodename?: string,
	isStopResponse?: boolean,
	retryCount = 0,
	skipLock = false,
	reminderRecipientID?: string,
	reminderData?: {
		reminder_purpose: string;
		reminder_lateness?: string | null;
	},
	selectedPersonaId?: number,
	isPersonaJob = false,
): Promise<void> {
	// 1. Initial Checks & State Loading
	const channel = message.channel;
	let locale = "en-US";

	// Early return for bot messages (including TomoriBot's own messages)
	if (message.author.bot && !isManuallyTriggered) {
		return;
	}

	// Debug logging for stop response
	if (isStopResponse) {
		log.info(
			`Processing stop response for message ${message.id} using original message as passport`,
		);
	}

	// Initialize streaming context for context-aware tool availability
	const streamingContext = {
		disableYouTubeProcessing: false, // Will be set to true during enhanced context restart
		disableProfilePictureProcessing: false, // Will be set to true during enhanced context restart
		disableGifProcessing: false, // Will be set to true during enhanced context restart
		forceReason, // Pass reasoning flag for enhanced AI responses
		isManuallyTriggered, // Pass command flag to indicate manual triggering
	};

	// biome-ignore lint/style/noNonNullAssertion: Author is always present in non-system messages
	const userDiscId = message.author!.id;

	// Check if user is allowed to trigger bot (Level 2 FULL privacy users cannot trigger)
	// Skip this check for manual triggers and reminders
	if (!isManuallyTriggered && !reminderRecipientID) {
		const userPrivacyLevel = await getCachedPrivacyLevel(userDiscId);
		if (userPrivacyLevel === PrivacyLevel.FULL) {
			// Silently ignore - Level 2 users chose to be completely invisible
			return;
		}
	}

	// Handle different channel types - Guild channels vs DM channels
	let guild: typeof message.guild;
	let serverDiscId: string;
	let isDMChannel = false;
	const isThreadChannel =
		channel.type === ChannelType.PublicThread ||
		channel.type === ChannelType.PrivateThread ||
		channel.type === ChannelType.AnnouncementThread;
	const isVoiceChannel =
		channel.type === ChannelType.GuildVoice ||
		channel.type === ChannelType.GuildStageVoice;

	if (
		channel instanceof BaseGuildTextChannel ||
		isThreadChannel ||
		isVoiceChannel
	) {
		// Standard guild text channel, thread, or voice/stage text
		// biome-ignore lint/style/noNonNullAssertion: Guild is always present in guild message events
		guild = message.guild!;
		serverDiscId = guild.id;
		isDMChannel = false;
	} else if (channel instanceof DMChannel) {
		// Direct Message channel - treat as pseudo-server
		guild = null;
		serverDiscId = userDiscId; // Use user ID as server ID for DMs
		isDMChannel = true;
		// Always treat DM messages as manually triggered (bypass trigger word checks)
		// Note: Using local variable to avoid parameter reassignment warning
		streamingContext.isManuallyTriggered = true;
		isManuallyTriggered = true; // Fix: Also update the parameter used in shouldBotReply check
		log.info(`Processing DM from user ${userDiscId} in channel ${channel.id}`);
	} else {
		// Group DMs or other unsupported channel types
		// Only show error embed if user actually tried to trigger the bot
		let shouldShowError = false;

		// Check if this was a manual trigger
		if (isManuallyTriggered) {
			shouldShowError = true;
		}
		// Check if message contains base trigger words
		else if (message.content) {
			for (const baseWord of BASE_TRIGGER_WORDS) {
				// For Japanese characters, check if the content includes them directly
				if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(baseWord)) {
					if (message.content.includes(baseWord)) {
						shouldShowError = true;
						break;
					}
				} else {
					// For English triggers, use word boundaries
					const regex = new RegExp(`\\b${escapeRegExp(baseWord)}\\b`, "i");
					if (regex.test(message.content)) {
						shouldShowError = true;
						break;
					}
				}
			}
		}
		// Check if bot was mentioned
		if (
			!shouldShowError &&
			client.user &&
			message.mentions.users.has(client.user.id)
		) {
			shouldShowError = true;
		}
		// Check if message is a reply to the bot
		if (!shouldShowError && message.reference?.messageId) {
			try {
				const referenceMessage = await message.channel.messages.fetch(
					message.reference.messageId,
				);
				if (
					referenceMessage &&
					referenceMessage.author.id === client.user?.id
				) {
					shouldShowError = true;
				}
			} catch (_fetchError) {
				// Silently ignore if we can't fetch the reference message
			}
		}

		// Only send error embed if user tried to trigger the bot
		if (
			shouldShowError &&
			"send" in channel &&
			// biome-ignore lint/style/noNonNullAssertion: client.user is checked during startup
			message.author.id !== client.user!.id
		) {
			const errorEmbed = createStandardEmbed(locale, {
				color: ColorCode.ERROR,
				titleKey: "general.errors.channel_not_supported_title",
				descriptionKey: "general.errors.channel_not_supported_description",
			});

			try {
				await channel.send({ embeds: [errorEmbed] });
			} catch (sendError) {
				log.error("Failed to send unsupported channel type message", sendError);
			}
		}
		return;
	}
	// Skip permission check for DMs as we always have send permission

	if (!isDMChannel && "permissionsFor" in channel) {
		// biome-ignore lint/style/noNonNullAssertion: client.user is checked during startup
		const permissions = channel.permissionsFor(client.user!);
		if (!permissions) {
			return;
		}
		const canSend = isThreadChannel
			? permissions.has("SendMessagesInThreads")
			: permissions.has("SendMessages");
		if (!canSend) {
			return;
		}
	}

	// --- Pre-Semaphore Tomori State Loading for shouldBotReply check ---
	// Attempt to load Tomori state early to determine if a reply would even be considered.
	// This helps decide if a "busy" message is warranted.
	// For multi-persona support, we load ALL personas early to check alter triggers
	let earlyTomoriState: TomoriState | null = null;
	let earlyAllPersonas: TomoriState[] = [];
	let earlyLoadAttempted = false;
	if (!skipLock) {
		try {
			earlyAllPersonas = await getCachedAllPersonas(serverDiscId);
			earlyTomoriState = earlyAllPersonas.find((p) => !p.is_alter) || null;
			earlyLoadAttempted = true;
		} catch (e) {
			// Log the error but don't stop; the main logic will try to load it again
			// and handle errors more comprehensively.
			earlyLoadAttempted = true;
			await log.error(
				// Rule 22
				`Failed to load TomoriState early for server ${serverDiscId} in tomoriChat's lock check phase.`,
				e,
				{
					// serverId will be the Discord ID here as internal might not be known
					errorType: "EarlyStateLoadingError",
					metadata: { serverDiscId: serverDiscId, channelId: channel.id },
				},
			);
		}
	}

	// --- Semaphore Logic (skipped for recursive retry calls) ---
	let lockEntry: ChannelLockEntry | undefined;
	if (!skipLock) {
		const channelLockId = channel.id;
		lockEntry = channelLocks.get(channelLockId);

		if (!lockEntry) {
			// 2. Initialize lock entry if it doesn't exist
			lockEntry = {
				isLocked: false,
				lockedAt: 0,
				currentMessageId: undefined,
				serverDiscId: serverDiscId, // Track server for rate limiting
				userDiscId: undefined, // Set when lock is acquired
				currentIsPersonaJob: false,
				messageQueue: [],
			};
			channelLocks.set(channelLockId, lockEntry);
		}

		if (
			lockEntry.isLocked &&
			Date.now() - lockEntry.lockedAt > CHANNEL_LOCK_TIMEOUT_MS
		) {
			// 3. Check for stale lock (if current message finds it locked)
			log.warn(
				`Channel ${channelLockId} lock is stale (locked since ${new Date(lockEntry.lockedAt).toISOString()} for message ${lockEntry.currentMessageId}). Forcibly releasing. Previous queue length: ${lockEntry.messageQueue.length}`,
			);
			lockEntry.isLocked = false; // Release stale lock
			lockEntry.userDiscId = undefined; // Clear user tracking
			lockEntry.currentIsPersonaJob = false;
			lockEntry.messageQueue = []; // Clear queue as well, as context might be very old
			// The current message will now attempt to acquire the lock.
		}

		// Handle stop requests while locked before rate limiting
		if (
			lockEntry.isLocked &&
			!isStopResponse &&
			isNaturalStopMessage(message.content)
		) {
			log.info(
				`Stop message detected in channel ${channelLockId} while processing message ${lockEntry.currentMessageId}. Signaling graceful stop.`,
			);

			const { StreamOrchestrator } = await import(
				"../../utils/discord/streamOrchestrator"
			);

			StreamOrchestrator.requestStop(channelLockId, message.author.id, {
				originalStopMessage: message,
				client,
			});

			log.info(
				`Stop signal sent for channel ${channelLockId}. Stop response will be generated after stream completes.`,
			);
			return;
		}

		// Global rate limit guard (applies before both immediate processing and enqueueing)
		if (!isStopResponse && !isPersonaJob) {
			const userActiveCount = getUserActiveMessageCount(userDiscId);
			const userRateCheck = checkUserRateLimit(userActiveCount);
			if (!userRateCheck.allowed) {
				log.warn(
					`User ${userDiscId} exceeded rate limit (${userRateCheck.currentCount}/${userRateCheck.maxLimit} active messages). Dropping message ${message.id}.`,
				);

				const tempUserRow = await getCachedUserRow(userDiscId);
				const userLocale =
					tempUserRow?.language_pref ?? guild?.preferredLocale ?? "en-US";

				await sendUserRateLimitDM(
					userDiscId,
					client,
					userLocale,
					userActiveCount,
				);

				return; // Drop message
			}

			const serverActiveCount = getServerActiveMessageCount(serverDiscId);
			const serverRateCheck = checkServerRateLimit(serverActiveCount);
			if (!serverRateCheck.allowed) {
				log.warn(
					`Server ${serverDiscId} exceeded rate limit (${serverRateCheck.currentCount}/${serverRateCheck.maxLimit} active messages). Dropping message ${message.id}.`,
				);

				const serverLocale = guild?.preferredLocale ?? "en-US";

				await sendServerRateLimitEmbed(
					channel,
					serverLocale,
					serverActiveCount,
				);

				return; // Drop message
			}
		}

		// MODIFIED: Check if locked AND if Tomori would reply
		if (lockEntry.isLocked) {
			// Only enqueue and send "busy" message if Tomori is set up and would have replied.
			if (earlyTomoriState) {
				// 1. Create a modified version of earlyTomoriState for the shouldBotReply check.
				// This simulates the autoch_counter as 1 for the decision to queue,
				// preventing queueing based solely on an auto-reply hit while Tomori is busy.
				const modifiedEarlyTomoriStateForCheck: TomoriState = {
					...earlyTomoriState,
					autoch_counter: 1, // Simulate counter as 1 for this check
				};

				// 2. Decide whether to enqueue based on the modified state.
				// Always enqueue if it's a manual command, otherwise use shouldBotReply logic
				if (
					isManuallyTriggered ||
					shouldBotReply(message, modifiedEarlyTomoriStateForCheck, earlyAllPersonas)
				) {
					// 2a. Check cooldown BEFORE queuing (skip for manual triggers)
					if (!isManuallyTriggered && !isStopResponse) {
						const preQueueCooldownResult = await checkMessageTriggerCooldown(
							message,
							earlyTomoriState.config,
						);
						if (preQueueCooldownResult.isOnCooldown) {
							// Show cooldown warning and don't queue
							const footerKey = getCooldownTypeFooterKey(
								preQueueCooldownResult.cooldownType,
							);
							const tempUserRow = await getCachedUserRow(userDiscId);
							const cooldownLocale =
								tempUserRow?.language_pref ?? guild?.preferredLocale ?? "en-US";
							await sendStandardEmbed(channel, cooldownLocale, {
								color: ColorCode.WARN,
								titleKey: "general.message_cooldown_title",
								descriptionKey: "general.message_cooldown",
								descriptionVars: {
									seconds: preQueueCooldownResult.remainingSeconds.toString(),
									botName: earlyTomoriState.tomori_nickname,
								},
								footerKey: footerKey,
							});
							log.info(
								`Message ${message.id} rejected before queuing due to cooldown. ${preQueueCooldownResult.remainingSeconds}s remaining.`,
							);
							return;
						}
					}

					// Rate limits already validated above, proceed with normal enqueueing
					lockEntry.messageQueue.push({
						message,
						isManuallyTriggered,
						forceReason,
						reasoningQuery,
						llmOverrideCodename,
						selectedPersonaId,
						isPersonaJob,
					});
					log.info(
						`Channel ${channelLockId} is busy (msg ${lockEntry.currentMessageId}). Enqueued message ${message.id}. Queue: ${lockEntry.messageQueue.length}. Tomori would reply (autoch_counter simulated as 0 for this check).`,
					);

					// 3. Send "busy" reply to the user if not the bot itself.
					// biome-ignore lint/style/noNonNullAssertion: client.user is checked during startup
					if (message.author.id !== client.user!.id) {
						try {
							const tempUserRow = await getCachedUserRow(userDiscId);
							const waitingLocale =
								tempUserRow?.language_pref ?? guild?.preferredLocale ?? "en-US";
							const currentMessageLink = lockEntry.currentMessageId
								? isDMChannel
									? `https://discord.com/channels/@me/${channel.id}/${lockEntry.currentMessageId}`
									: guild?.id
										? `https://discord.com/channels/${guild.id}/${channel.id}/${lockEntry.currentMessageId}`
										: "a previous message"
								: "a previous message";

							// Void unused variables (kept for potential future re-enabling of busy embed)
							void tempUserRow;
							void waitingLocale;
							void currentMessageLink;

							/*
							const busyEmbed = createStandardEmbed(waitingLocale, {
								titleKey: "general.tomori_busy_title",
								descriptionKey: "general.tomori_busy_replying",
								descriptionVars: { message_link: currentMessageLink },
								color: ColorCode.INFO,
								flags: MessageFlags.Ephemeral,
							});
							await message.reply({ embeds: [busyEmbed] }).catch((e) => {
								log.error(
									// Rule 22
									"Failed to send ephemeral 'Tomori busy' reply",
									e,
									{
										userId: tempUserRow?.user_id,
										serverId: earlyTomoriState?.server_id, // Use original earlyTomoriState for accurate ID
										errorType: "EphemeralReplyError",
										metadata: {
											messageId: message.id,
											channelId: channel.id,
											currentMessageIdInQueue: lockEntry?.currentMessageId,
											userDiscId,
											guildDiscId: guild?.id || null, // null for DMs
											isDMChannel,
										},
									},
								);
							});*/
						} catch (e) {
							log.error(
								// Rule 22
								"Failed to prepare 'Tomori busy' ephemeral reply (state/locale error)",
								e,
								{
									errorType: "BusyReplyPrepError",
									metadata: {
										messageId: message.id,
										channelId: channel.id,
										userDiscId,
										guildDiscId: guild?.id || null, // null for DMs
										isDMChannel,
									},
								},
							);
						}
					}
				} else {
					// If locked, but Tomori wouldn't reply anyway (e.g., not setup, or message doesn't trigger,
					// even with simulated counter reset), then don't enqueue or send busy message.
					log.info(
						`Channel ${channelLockId} is busy (msg ${lockEntry.currentMessageId}), but message ${message.id} would not have triggered a reply from Tomori (autoch_counter simulated as 0 for this check). Ignoring for queue.`,
					);
				}
			} else {
				// earlyTomoriState is null, meaning Tomori is not set up on this server.
				// In this case, Tomori wouldn't reply anyway, so don't enqueue.
				log.info(
					`Channel ${channelLockId} is busy (msg ${lockEntry.currentMessageId}), but Tomori is not set up on this server (earlyTomoriState is null). Message ${message.id} ignored for queue.`,
				);
			}
			return; // Message enqueued, or ignored because Tomori wouldn't reply anyway.
		}

		// 5. Acquire the lock for the current message
		lockEntry.isLocked = true;
		lockEntry.lockedAt = Date.now();
		lockEntry.currentMessageId = message.id;
		lockEntry.userDiscId = userDiscId; // Track user for rate limiting
		lockEntry.currentIsPersonaJob = isPersonaJob;
	}
	// --- End Semaphore Logic ---

	// 2. Load critical state data early to use throughout function
	try {
		try {
			// Load all personas (main + alters) for multi-persona support
			// For backward compatibility, we also get the main persona separately
			const allPersonas = await getCachedAllPersonas(serverDiscId);
			const mainPersona = allPersonas.find((p) => !p.is_alter) || null;
			const fallbackPersona =
				mainPersona ?? (allPersonas.length > 0 ? allPersonas[0] : null);
			let tomoriState = earlyLoadAttempted ? earlyTomoriState : fallbackPersona;
			const userRow = await getCachedUserRow(userDiscId);
			locale = userRow?.language_pref ?? "en-US"; // Set locale based on user pref

			// Determine triggererName based on blacklist and personalization settings
			const isUserBlacklisted = await getCachedBlacklistStatus(
				serverDiscId,
				userDiscId,
			);
			const serverPersonalizationDisabled =
				tomoriState?.config.personal_memories_enabled === false;

			// Use Discord username if user is blacklisted OR server personalization is disabled OR no custom nickname exists
			const triggererName =
				isUserBlacklisted ||
				serverPersonalizationDisabled ||
				!userRow?.user_nickname
					? message.author.username
					: userRow.user_nickname;

			// Create per-request snapshot to avoid redundant DB queries and ensure consistency
			// Get user's privacy level
			const userPrivacyLevel = await getCachedPrivacyLevel(userDiscId);
			const isUserOptedOut = userPrivacyLevel === PrivacyLevel.FULL; // Backward compat: Level 2 is FULL privacy

			// Preload guild member for presence lookups (only if not DM)
			let preloadedMember = null;
			if (!isDMChannel && guild) {
				preloadedMember = await guild.members
					.fetch(userDiscId)
					.catch(() => null);
			}

			// Create the snapshot
			const requestSnapshot: RequestSnapshot = {
				tomoriState: tomoriState ?? undefined,
				triggererUserRow: userRow ?? null,
				isTriggererBlacklisted: isUserBlacklisted,
				isTriggererOptedOut: isUserOptedOut,
				triggererPrivacyLevel: userPrivacyLevel, // NEW
				preloadedMember: preloadedMember,
			};

			log.info(
				`[Snapshot] Created per-request snapshot for message ${message.id} in ${isDMChannel ? "DM" : `server ${serverDiscId}`}`,
			);

			const selectedPersona = selectedPersonaId
				? allPersonas.find((p) => p.tomori_id === selectedPersonaId) ??
					fallbackPersona
				: fallbackPersona;
			const personaByNickname = new Map<string, TomoriState>();
			for (const persona of allPersonas) {
				const nicknameKey = persona.tomori_nickname?.toLowerCase();
				if (!nicknameKey || personaByNickname.has(nicknameKey)) continue;
				personaByNickname.set(nicknameKey, persona);
			}

			// Function to check for base trigger words - stays contained within the try block
			function checkForBaseTriggerWords(content: string): boolean {
				// Check for exact matches with word boundaries (case-insensitive)
				for (const baseWord of BASE_TRIGGER_WORDS) {
					// For Japanese characters, check if the content includes them directly
					if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(baseWord)) {
						if (content.includes(baseWord)) {
							return true;
						}
					} else {
						// For English triggers, use word boundaries to ensure it's a distinct word
						const regex = new RegExp(`\\b${escapeRegExp(baseWord)}\\b`, "i");
						if (regex.test(content)) {
							return true;
						}
					}
				}
				return false;
			}

			/**
			 * Check if an embed title matches target localizer keys that should be processed as text.
			 * Checks against all supported locales to handle cross-locale embed detection.
			 * @param embedTitle - The embed title to check
			 * @returns Object with isTarget boolean and the type of target found
			 */
			function checkTargetEmbedTitle(embedTitle: string | null): {
				isTarget: boolean;
				type: "memory_learning" | "reset" | "reminder_set" | null;
			} {
				if (!embedTitle) return { isTarget: false, type: null };

				// Check against all supported locales to handle cross-locale scenarios
				// (e.g., Japanese user creates reset embed, English user should still detect it)
				for (const supportedLocale of getSupportedLocales()) {
					// Target localizer keys for memory learning embeds
					const memoryLearningTitles = [
						localizer(
							supportedLocale,
							"genai.self_teach.server_memory_learned_title",
						),
						localizer(
							supportedLocale,
							"genai.self_teach.personal_memory_learned_title",
						),
					];

					// Target localizer key for conversation reset
					const resetTitle = localizer(
						supportedLocale,
						"commands.tool.refresh.title",
					);

					// Target localizer key for reminder set confirmation
					const reminderSetTitle = localizer(
						supportedLocale,
						"reminders.reminder_set_title",
					);

					// Check for memory learning embeds
					if (memoryLearningTitles.some((title) => embedTitle === title)) {
						return { isTarget: true, type: "memory_learning" };
					}

					// Check for reset embed
					if (embedTitle === resetTitle) {
						return { isTarget: true, type: "reset" };
					}

					// Check for reminder set confirmation embed
					if (embedTitle === reminderSetTitle) {
						return { isTarget: true, type: "reminder_set" };
					}
				}

				// EXTENSIBILITY EXAMPLE: Adding new embed types is easy!
				// 1. Add new type to union: 'memory_learning' | 'reset' | 'reminder_set' | 'new_type' | null
				// 2. Add new localizer checks inside the locale loop:
				// const newTypeTitles = [
				// ];
				// if (newTypeTitles.some(title => embedTitle === title)) {
				//     return { isTarget: true, type: 'new_type' };
				// }

				return { isTarget: false, type: null };
			}

			/**
			 * Process link preview embeds to extract text and image content for AI context.
			 * Detects automatic Discord embeds generated from links (Twitter, YouTube, articles, etc.)
			 * @param embed - The Discord embed to process
			 * @returns Object with extracted content and image information
			 */
			function processLinkEmbed(embed: Embed): {
				isLinkPreview: boolean;
				textContent: string | null;
				imageInfo: {
					url: string;
					proxyUrl: string;
					mimeType: string | null;
					filename: string;
				} | null;
				thumbnailInfo: {
					url: string;
					proxyUrl: string;
					mimeType: string | null;
					filename: string;
				} | null;
			} {
				// 1. Check if this is a link preview embed (has url and some content)
				if (!embed.url && !embed.title && !embed.description) {
					return {
						isLinkPreview: false,
						textContent: null,
						imageInfo: null,
						thumbnailInfo: null,
					};
				}

				// 2. Skip system embeds that we already process elsewhere
				const embedCheck = checkTargetEmbedTitle(embed.title);
				if (embedCheck.isTarget) {
					return {
						isLinkPreview: false,
						textContent: null,
						imageInfo: null,
						thumbnailInfo: null,
					};
				}

				// 3. Extract text content (title, description) with simple "Link Content:" prefix
				let textContent = "";

				// Build content parts
				const contentParts: string[] = [];
				if (embed.title) {
					contentParts.push(embed.title);
				}
				if (embed.description) {
					// Limit description length to avoid overly long content
					const maxDescLength = 500;
					const description =
						embed.description.length > maxDescLength
							? `${embed.description.substring(0, maxDescLength)}...`
							: embed.description;
					contentParts.push(description);
				}

				// Format with simple "Link Content:" prefix if we have any content
				if (contentParts.length > 0) {
					textContent = `[Link Content: ${contentParts.join(" - ")}]`;
				}

				// 4. Process embed image if present
				let imageInfo = null;
				if (embed.image?.url) {
					try {
						// Generate filename from URL or use generic name
						const imageUrl = new URL(embed.image.url);
						let filename = imageUrl.pathname.split("/").pop() || "embed_image";

						// Handle social media image URLs with size suffixes (e.g., :large, :medium, :small)
						// Twitter: G0EdxONbMAAiJJG.jpg:large -> G0EdxONbMAAiJJG.jpg
						filename = filename.replace(/:(large|medium|small|orig)$/, "");

						// Determine MIME type based on file extension
						let mimeType = "image/jpeg"; // Default to JPEG for most social media images
						const extension = filename.split(".").pop()?.toLowerCase();
						switch (extension) {
							case "png":
								mimeType = "image/png";
								break;
							case "gif":
								mimeType = "image/gif";
								break;
							case "webp":
								mimeType = "image/webp";
								break;
							default:
								mimeType = "image/jpeg";
								break;
						}

						// Ensure filename has extension
						if (!filename.includes(".")) {
							filename = `${filename}.jpg`;
						}

						imageInfo = {
							url: embed.image.url,
							proxyUrl: embed.image.proxyURL || embed.image.url,
							mimeType: mimeType,
							filename: filename,
						};
					} catch (_error) {
						// Silently handle URL parsing errors for embed images
					}
				}

				// 5. Process embed thumbnail if present (and no main image)
				let thumbnailInfo = null;
				if (embed.thumbnail?.url && !imageInfo) {
					try {
						const thumbnailUrl = new URL(embed.thumbnail.url);
						let filename =
							thumbnailUrl.pathname.split("/").pop() || "embed_thumbnail";

						// Handle social media thumbnail URLs with size suffixes
						filename = filename.replace(/:(large|medium|small|orig)$/, "");

						// Determine MIME type based on file extension
						let mimeType = "image/jpeg"; // Default to JPEG
						const extension = filename.split(".").pop()?.toLowerCase();
						switch (extension) {
							case "png":
								mimeType = "image/png";
								break;
							case "gif":
								mimeType = "image/gif";
								break;
							case "webp":
								mimeType = "image/webp";
								break;
							default:
								mimeType = "image/jpeg";
								break;
						}

						// Ensure filename has extension
						if (!filename.includes(".")) {
							filename = `${filename}.jpg`;
						}

						thumbnailInfo = {
							url: embed.thumbnail.url,
							proxyUrl: embed.thumbnail.proxyURL || embed.thumbnail.url,
							mimeType: mimeType,
							filename: filename,
						};
					} catch (_error) {
						// Silently handle URL parsing errors for embed thumbnails
					}
				}

				return {
					isLinkPreview: true,
					textContent: textContent.trim() || null,
					imageInfo,
					thumbnailInfo,
				};
			}

			// 3. Enhanced direct trigger checks (base words or direct reply)
			let isReplyToBot = false;
			let replyPersona: TomoriState | null = null;
			let isBaseTriggerWord = false;

			// Check if message is a reply to the bot
			if (message.reference?.messageId) {
				try {
					const referenceMessage = await message.channel.messages.fetch(
						message.reference.messageId,
					);
					if (referenceMessage) {
						if (referenceMessage.author.id === client.user?.id) {
							isReplyToBot = true;
						} else if (referenceMessage.webhookId) {
							const webhookName = referenceMessage.author.username;
							const matchedPersona = webhookName
								? personaByNickname.get(webhookName.toLowerCase())
								: undefined;
							if (matchedPersona) {
								replyPersona = matchedPersona;
							}
						}
					}
				} catch (fetchError) {
					log.warn(
						"Could not fetch reference message for reply check",
						fetchError,
					);
				}
			}

			const isReplyToPersona = isReplyToBot || !!replyPersona;

			// Check for base trigger words
			isBaseTriggerWord = checkForBaseTriggerWords(message.content);

			// Check if bot was mentioned
			const isBotMentioned = !!(
				client.user && message.mentions.users.has(client.user.id)
			);

			// 4. Early validation for directly triggered messages or manual triggers (including DMs)
			// For DMs, always validate regardless of content since all DM messages should trigger responses
			if (
				isBaseTriggerWord ||
				isReplyToPersona ||
				isBotMentioned ||
				isManuallyTriggered ||
				(isDMChannel && message.author.id !== client.user?.id)
			) {
				// If user directly mentioned Tomori, replied to it, mentioned the bot, or manually triggered (DMs), validate state

				// Validate Tomori is set up
				if (!tomoriState) {
					const contextMessage = isDMChannel
						? `User tried to use Tomori in DM but no Tomori instance found for user ${userDiscId}.`
						: `User mentioned Tomori in server ${serverDiscId} but Tomori not set up.`;
					log.info(contextMessage);

					await sendStandardEmbed(channel, locale, {
						color: ColorCode.ERROR,
						titleKey: "general.errors.tomori_not_setup_title",
						descriptionKey: "general.errors.tomori_not_setup_description",
						...(isDMChannel && {
							footerKey: "general.errors.tomori_not_setup_dm_footer",
						}),
					});
					return;
				}

				// Validate API key is configured
				if (!tomoriState.config.api_key) {
					const contextMessage = isDMChannel
						? `User tried to use Tomori in DM but API key not configured for user ${userDiscId}.`
						: `User mentioned Tomori in server ${serverDiscId} but API key not configured.`;
					log.info(contextMessage);

					await sendStandardEmbed(channel, locale, {
						color: ColorCode.ERROR,
						titleKey: "general.errors.api_key_missing_title",
						descriptionKey: "general.errors.api_key_missing_description",
						...(isDMChannel && {
							footerKey: "general.errors.tomori_not_setup_dm_footer",
						}),
					});
					return;
				}
			} else if (!tomoriState) {
				// For non-direct messages, just log and return if Tomori isn't set up
				// log.info(`Tomori state not found for server ${serverDiscId}. Skipping non-triggered message.`); // Reduce noise
				return;
			}

			// 5. Auto-Counter Update (only needs to happen if Tomori is set up)
			const config = tomoriState.config;
			const isAutoChannelActive =
				config.autoch_threshold > 0 && config.autoch_disc_ids.length > 0;

			if (
				!message.author.bot &&
				isAutoChannelActive &&
				config.autoch_disc_ids.includes(channel.id)
			) {
				if (!tomoriState.tomori_id) {
					log.error(
						`Tomori ID missing for server ${serverDiscId} during counter increment.`,
					);
				} else {
					try {
						const updatedTomoriRow = await incrementTomoriCounter(
							tomoriState.tomori_id,
							config.autoch_threshold,
						);
						if (updatedTomoriRow) {
							tomoriState.autoch_counter = updatedTomoriRow.autoch_counter;
							log.info(
								`Auto-message counter updated for server ${serverDiscId}. New value: ${tomoriState.autoch_counter}`,
							);
						} else {
							log.warn(
								`Failed to update auto-message counter for server ${serverDiscId}.`,
							);
						}
					} catch (dbError) {
						log.error(
							`Error updating auto-message counter for server ${serverDiscId}`,
							dbError,
						);
					}
				}
			}

			// 6. Determine if Bot Should Reply using shouldBotReply helper
			// Skip check if this is a manual command trigger
			if (!isManuallyTriggered && !shouldBotReply(message, tomoriState, allPersonas)) {
				return;
			}

			// 7. Check message trigger cooldown (skip for manual triggers and stop responses)
			if (!isManuallyTriggered && !isStopResponse) {
				const cooldownResult = await checkMessageTriggerCooldown(
					message,
					tomoriState.config,
				);
				if (cooldownResult.isOnCooldown) {
					// Send cooldown warning embed
					const footerKey = getCooldownTypeFooterKey(
						cooldownResult.cooldownType,
					);
					await sendStandardEmbed(channel, locale, {
						color: ColorCode.WARN,
						titleKey: "general.message_cooldown_title",
						descriptionKey: "general.message_cooldown",
						descriptionVars: {
							seconds: cooldownResult.remainingSeconds.toString(),
							botName: tomoriState.tomori_nickname,
						},
						footerKey: footerKey,
					});
					log.info(
						`Message trigger cooldown active for ${
							cooldownResult.cooldownType === CooldownType.PER_USER
								? `user ${message.author.id}`
								: cooldownResult.cooldownType === CooldownType.PER_CHANNEL
									? `channel ${message.channelId}`
									: `server ${serverDiscId}`
						}. ${cooldownResult.remainingSeconds}s remaining.`,
					);
					return;
				}
			}

			log.info(`Conditions met for Gemini reply in server ${serverDiscId}`);

			// 8. Set message trigger cooldown (skip for manual triggers and stop responses)
			// Set early to prevent race conditions with concurrent triggers
			if (!isManuallyTriggered && !isStopResponse) {
				await setMessageTriggerCooldown(message, tomoriState.config);
			}

			// 8.5. Multi-Persona: Determine which personas should respond
			// For manual triggers, respond with the selected persona (if provided)
			// For reminders/stop responses, only the main persona responds
			let personasToRespond: TomoriState[];
			if (isManuallyTriggered) {
				personasToRespond = selectedPersona ? [selectedPersona] : [];
			} else if (reminderRecipientID || isStopResponse) {
				// Only main persona for reminders and stop responses
				personasToRespond = tomoriState ? [tomoriState] : [];
			} else {
				// Check if auto-message threshold is hit for this message
				const config = tomoriState?.config;
				const isAutoMsgHit =
					config &&
					config.autoch_threshold > 0 &&
					config.autoch_disc_ids.length > 0 &&
					config.autoch_disc_ids.includes(message.channel.id) &&
					tomoriState.autoch_counter > 0 &&
					tomoriState.autoch_counter % config.autoch_threshold === 0;

				// Determine matching personas using the helper function
				personasToRespond = determineMatchingPersonas(
					message,
					allPersonas,
					client,
					isReplyToBot,
					replyPersona,
					isBotMentioned,
					!!isAutoMsgHit, // Convert to boolean
				);
			}

			// If no personas match, return early
			if (personasToRespond.length === 0) {
				log.info(
					`No personas matched trigger for message ${message.id} in server ${serverDiscId}`,
				);
				return;
			}

			log.info(
				`${personasToRespond.length} persona(s) will respond to message ${message.id}: ${personasToRespond.map((p) => p.tomori_nickname).join(", ")}`,
			);

			// 8.55. Multi-Persona Queueing: enqueue additional personas as jobs
			// Use the existing queue to process personas sequentially so later personas can see earlier responses.
			if (
				!isManuallyTriggered &&
				!reminderRecipientID &&
				!isStopResponse &&
				personasToRespond.length > 1 &&
				lockEntry
			) {
				const [firstPersona, ...remainingPersonas] = personasToRespond;
				const personasToQueue: Array<{
					persona: TomoriState;
					selectedPersonaId: number;
				}> = [];
				const personasToHandleNow: TomoriState[] = [firstPersona];

				for (const persona of remainingPersonas) {
					if (persona.tomori_id) {
						personasToQueue.push({
							persona,
							selectedPersonaId: persona.tomori_id,
						});
					} else {
						log.warn(
							`Persona "${persona.tomori_nickname}" is missing tomori_id; handling in current pass instead of queueing.`,
						);
						personasToHandleNow.push(persona);
					}
				}

				if (personasToQueue.length > 0) {
					// Insert queued persona jobs at the front so they run before other queued messages.
					for (let i = personasToQueue.length - 1; i >= 0; i--) {
						const queuedPersona = personasToQueue[i];
						lockEntry.messageQueue.unshift({
							message,
							isManuallyTriggered: true,
							forceReason,
							reasoningQuery,
							llmOverrideCodename,
							selectedPersonaId: queuedPersona.selectedPersonaId,
							isPersonaJob: true,
						});
					}

					log.info(
						`Queued ${personasToQueue.length} persona job(s) for message ${message.id}: ${personasToQueue
							.map((p) => p.persona.tomori_nickname)
							.join(", ")}`,
					);
				}

				personasToRespond = personasToHandleNow;
			}

			// 8.6. Multi-Persona: Get/create webhook for multi-avatar responses
			// Only create webhook if we have alters responding (main persona uses regular bot messages)
			const hasAlters = personasToRespond.some((p) => p.is_alter);
			let channelWebhook: Webhook | null = null;
			let webhookErrorReason: WebhookCreateErrorReason | undefined;
			let webhookErrorNotified = false;
			const usePersonaWebhooks = !IS_PRODUCTION;
			// Support both text channels and threads
			const supportsWebhooks =
				channel.type === ChannelType.GuildText ||
				channel.type === ChannelType.PublicThread ||
				channel.type === ChannelType.PrivateThread ||
				channel.type === ChannelType.AnnouncementThread;

			if (hasAlters && supportsWebhooks && !usePersonaWebhooks) {
				const webhookResult = await getOrCreateWebhook(channel as TextChannel);
				channelWebhook = webhookResult.webhook;
				webhookErrorReason = webhookResult.errorReason;

				if (channelWebhook) {
					log.info(
						`Webhook ready for multi-persona responses in ${channel.type} ${channel.id}`,
					);
				} else if (webhookErrorReason) {
					await sendWebhookErrorEmbed(channel, locale, webhookErrorReason);
					webhookErrorNotified = true;
				}
			}

			// 9. Prepare Data for buildContext
			await channel.sendTyping();

			/**
			 * Fetch recent message history for context building.
			 * Note: We always fetch from API rather than relying on cache to ensure we have
			 * the most recent consecutive messages in correct order. Cache may contain gaps
			 * or out-of-order messages from gateway events.
			 */
			const fetchedMessages = await channel.messages.fetch({
				limit: MESSAGE_FETCH_LIMIT,
			});

			// Convert to array and reverse to get chronological order (oldest first)
			const messagesArray = Array.from(fetchedMessages.values()).reverse();

			// MODIFIED: If processing a message from the queue, ensure it's treated as the latest message for context
			const queuedMessageId = message.id;
			const indexOfQueuedMessage = messagesArray.findIndex(
				(m) => m.id === queuedMessageId,
			);

			if (isFromQueue) {
				if (indexOfQueuedMessage !== -1) {
					// 1. Remove the queued message from its current position in the fetched history
					const [queuedMessageInHistory] = messagesArray.splice(
						indexOfQueuedMessage,
						1,
					);
					// 2. Add it (or the current message object, which should be identical) to the very end
					messagesArray.push(queuedMessageInHistory); // Using the one from history ensures it's the exact same object reference
					log.info(
						`Queued message ${queuedMessageId} was found in fetched history and moved to the end for context building.`,
					);
				} else {
					// 3. If not found (e.g., older than MESSAGE_FETCH_LIMIT or deleted), append the current 'message' object.
					// This ensures its content is present, though its original surrounding history might be incomplete.
					messagesArray.push(message as Message<true>);
					log.warn(
						`Queued message ${queuedMessageId} not found in fetched history. Appending current message object directly. This might occur if it's older than MESSAGE_FETCH_LIMIT or was deleted.`,
					);
				}
			}

			// 8. Find the index of the *last* reset message (most recent)
			// This message could be from the bot (confirmation embed) or a user command
			let resetIndex = -1;
			for (let i = messagesArray.length - 1; i >= 0; i--) {
				const msg = messagesArray[i];

				// Check if *any* embed in the message contains a reset title using localizer
				const embedContainsReset = msg.embeds.some((embed) => {
					const embedCheck = checkTargetEmbedTitle(embed.title);
					return embedCheck.isTarget && embedCheck.type === "reset";
				});

				// If an embed contains the marker, this is our reset point
				if (embedContainsReset) {
					resetIndex = i;
					log.info(
						`Reset marker detected in message content or embed at index ${i} from ${msg.author.username}. History will start after this message.`,
					);
					// Found the most recent reset marker, stop searching
					break;
				}
			}

			// 9. Determine the messages to include in the history
			const startIndex = resetIndex === -1 ? 0 : resetIndex + 1;
			const relevantMessagesArray = messagesArray.slice(startIndex);
			// 10. Build the `SimplifiedMessageForContext` array and user list from relevant messages
			const simplifiedMessages: SimplifiedMessageForContext[] = []; // Array for structured messages
			const userListSet = new Set<string>(); // Still useful for fetching user-specific memories/data

			// Find the most recent message with a reference (latest in the array)
			let latestReferenceMessageIndex = -1;
			for (let i = relevantMessagesArray.length - 1; i >= 0; i--) {
				if (relevantMessagesArray[i].reference?.messageId) {
					latestReferenceMessageIndex = i;
					break; // Found the most recent one, stop searching
				}
			}

			const shouldExtractEmojiImages = tomoriState.llm.sees_images;

			for (const [index, msg] of relevantMessagesArray.entries()) {
				const authorId = msg.author.id;
				//const isLastMessage = index === relevantMessagesArray.length - 1;

				// Filter out Level 2 (FULL privacy) users from conversation history
				const authorPrivacyLevel = await getCachedPrivacyLevel(authorId);
				if (authorPrivacyLevel === PrivacyLevel.FULL) {
					log.info(
						`Filtering message from user ${authorId} (privacy level FULL)`,
					);
					continue; // Skip this message entirely
				}

				// Variable to store referenced message data for later attachment extraction
				let referencedMessageData: { message: Message } | undefined;

				// 1. Check for debug prefix "$:" at the start of the message
				const isDebugMessage = msg.content.startsWith("$:"); // Easter egg functionality hehehe
				let processedContent = msg.content;

				// 2. If debug prefix found, trim it and treat message as coming from bot
				if (isDebugMessage) {
					processedContent = msg.content.slice(2); // Remove "$:" prefix
				}

				// 3. Add reference context only for the most recent message with a reference
				if (
					index === latestReferenceMessageIndex &&
					msg.reference?.messageId &&
					processedContent
				) {
					try {
						const msgReferencedMessage = await channel.messages.fetch(
							msg.reference.messageId,
						);
						if (msgReferencedMessage) {
							// Get the author name for the referenced message
							const referencedAuthorName =
								msgReferencedMessage.author.id === client.user?.id
									? tomoriState?.tomori_nickname || "Bot"
									: msgReferencedMessage.author.username;

							// Get the referenced message content (truncate if too long)
							let referencedContent =
								msgReferencedMessage.content || "[No text content]";
							if (referencedContent.length > 200) {
								referencedContent = `${referencedContent.substring(0, 197)}...`;
							}

							// Store referenced message info for later attachment extraction
							// (attachments will be processed after imageAttachments/videoAttachments arrays are declared)
							referencedMessageData = {
								message: msgReferencedMessage,
							};

							// Create enhanced reference context that mentions attachments (will be updated later)
							let attachmentInfo = "";
							// Temporarily count attachments to show in context
							let imageCount = 0;
							let videoCount = 0;
							if (msgReferencedMessage.attachments.size > 0) {
								for (const attachment of msgReferencedMessage.attachments.values()) {
									if (
										attachment.contentType?.startsWith("image/png") ||
										attachment.contentType?.startsWith("image/jpeg") ||
										attachment.contentType?.startsWith("image/webp") ||
										attachment.contentType?.startsWith("image/heic") ||
										attachment.contentType?.startsWith("image/heif") ||
										attachment.contentType?.startsWith("image/gif")
									) {
										imageCount++;
									} else if (
										attachment.contentType &&
										SUPPORTED_VIDEO_MIME_TYPES.some((type) =>
											attachment.contentType?.startsWith(type),
										)
									) {
										videoCount++;
									}
								}
							}

							if (imageCount > 0) {
								attachmentInfo += ` (with ${imageCount} image${imageCount > 1 ? "s" : ""})`;
							}
							if (videoCount > 0) {
								attachmentInfo += ` (with ${videoCount} video${videoCount > 1 ? "s" : ""})`;
							}

							const referenceMessageId = msgReferencedMessage.id;

							// Add reference context to the message
							const referenceContext = `[System: This message is referring to a previous message (ID: ${referenceMessageId}) by ${referencedAuthorName} saying: ${referencedContent}${attachmentInfo}]`;
							processedContent = `${referenceContext}\n${processedContent}`;
						}
					} catch (fetchError) {
						log.warn(
							`Could not fetch referenced message ${msg.reference.messageId} for context`,
							fetchError,
						);
					}
				}

				// 4. Determine author name and ID based on message type
				let effectiveAuthorId = authorId;
				let authorName: string;
				let authorType: "user" | "persona" = "user";
				let personaName: string | null = null;
				const isWebhookMessage = Boolean(msg.webhookId);

				if (msg.author.id === client.user?.id || isDebugMessage) {
					const mainNickname =
						mainPersona?.tomori_nickname ??
						tomoriState?.tomori_nickname ??
						msg.author.username;
					authorName = mainNickname; // Use main persona nickname for bot/debug messages
					authorType = "persona";
					personaName = mainNickname;
				} else if (isWebhookMessage) {
					const webhookName = msg.author.username;
					const matchedPersona = webhookName
						? personaByNickname.get(webhookName.toLowerCase())
						: undefined;

					if (matchedPersona) {
						authorName = matchedPersona.tomori_nickname;
						authorType = "persona";
						personaName = matchedPersona.tomori_nickname;
						effectiveAuthorId = `persona:${matchedPersona.tomori_id ?? matchedPersona.tomori_nickname}`;
					} else {
						authorName = webhookName || `<@${authorId}>`;
					}
				} else {
					authorName = `<@${authorId}>`; // Format user as <@ID>, to be converted by convertMentions later to user's registered name (if existing)
				}

				// Add to user list (Level 2 FULL privacy users already filtered out above)
				userListSet.add(authorId);

				const imageAttachments: SimplifiedMessageForContext["imageAttachments"] =
					[];
				const videoAttachments: SimplifiedMessageForContext["videoAttachments"] =
					[];
				let messageContentForLlm: string | null = processedContent; // Use processed content (with reference context and "$:" removed if present)
				let hasProcessedEmbed = false; // Track if this message contains a processed embed
				let mediaSourceMessageId: string | null = null;
				let hasLocalMedia = false;

				// Extract attachments from referenced message if it exists (after arrays are declared)
				// Check if this is the message that got reference context injection and we have stored reference message data
				if (
					index === latestReferenceMessageIndex &&
					typeof referencedMessageData !== "undefined"
				) {
					const preRefImageCount = imageAttachments.length;
					const preRefVideoCount = videoAttachments.length;

					if (referencedMessageData.message.attachments.size > 0) {
						for (const attachment of referencedMessageData.message.attachments.values()) {
							if (
								attachment.contentType?.startsWith("image/png") ||
								attachment.contentType?.startsWith("image/jpeg") ||
								attachment.contentType?.startsWith("image/webp") ||
								attachment.contentType?.startsWith("image/heic") ||
								attachment.contentType?.startsWith("image/heif") ||
								attachment.contentType?.startsWith("image/gif")
							) {
								imageAttachments.push({
									url: attachment.url,
									proxyUrl: attachment.proxyURL,
									mimeType: attachment.contentType,
									filename: attachment.name,
								});
							} else if (
								attachment.contentType &&
								SUPPORTED_VIDEO_MIME_TYPES.some((type) =>
									attachment.contentType?.startsWith(type),
								)
							) {
								videoAttachments.push({
									url: attachment.url,
									proxyUrl: attachment.proxyURL,
									mimeType: attachment.contentType,
									filename: attachment.name,
									isYouTubeLink: false,
								});
							}
						}
					}

					if (
						shouldExtractEmojiImages &&
						referencedMessageData.message.content
					) {
						const referencedEmojiAttachments = extractEmojiImageAttachments(
							referencedMessageData.message.content,
						);
						if (referencedEmojiAttachments.length > 0) {
							imageAttachments.push(...referencedEmojiAttachments);
						}
					}

					if (
						imageAttachments.length > preRefImageCount ||
						videoAttachments.length > preRefVideoCount
					) {
						mediaSourceMessageId = referencedMessageData.message.id;
					}

					// Log attachment extraction for debugging
					const extractedImages = imageAttachments.length;
					const extractedVideos = videoAttachments.filter(
						(v) => !v.isYouTubeLink,
					).length;
					if (extractedImages > 0 || extractedVideos > 0) {
						log.info(
							`Extracted ${extractedImages} images and ${extractedVideos} videos from referenced message ${referencedMessageData.message.id}`,
						);
					}
				}

				// Process embeds for target titles that should be included as text content
				if (msg.embeds.length > 0) {
					for (const embed of msg.embeds) {
						// 1. Process system embeds (existing logic) - scan ALL messages including bot messages
						const embedCheck = checkTargetEmbedTitle(embed.title);
						if (
							embedCheck.isTarget &&
							(embedCheck.type === "memory_learning" ||
								embedCheck.type === "reminder_set") &&
							embed.description
						) {
							// Remove bot name prefix from embed description if present
							let cleanedDescription = embed.description;
							if (tomoriState?.tomori_nickname) {
								// Escape special regex characters in the bot nickname
								const escapedNickname = tomoriState.tomori_nickname.replace(
									/[.*+?^${}()|[\]\\]/g,
									"\\$&",
								);
								const botNamePattern = new RegExp(
									`^${escapedNickname}:\\s*`,
									"i",
								);
								if (botNamePattern.test(cleanedDescription)) {
									cleanedDescription = cleanedDescription
										.replace(botNamePattern, "")
										.trim();
								}
							}

							// Add embed content to message text with special marker
							const embedContent = `[The following is a system-produced embed]\n${cleanedDescription}`;
							messageContentForLlm = messageContentForLlm
								? `${messageContentForLlm}\n${embedContent}`
								: embedContent;
							hasProcessedEmbed = true;
						}

						// 2. Process link preview embeds (new logic) - ONLY for non-bot messages
						else if (!msg.author.bot) {
							const linkEmbedData = processLinkEmbed(embed);
							if (linkEmbedData.isLinkPreview) {
								// Add link embed text content to message if present
								if (linkEmbedData.textContent) {
									messageContentForLlm = messageContentForLlm
										? `${messageContentForLlm}\n${linkEmbedData.textContent}`
										: linkEmbedData.textContent;
								}

								// Add embed image to imageAttachments if present
								if (linkEmbedData.imageInfo) {
									imageAttachments.push({
										url: linkEmbedData.imageInfo.url,
										proxyUrl: linkEmbedData.imageInfo.proxyUrl,
										mimeType: linkEmbedData.imageInfo.mimeType,
										filename: linkEmbedData.imageInfo.filename,
									});
									hasLocalMedia = true;
									log.info(
										`Added embed image from link preview: ${linkEmbedData.imageInfo.filename}`,
									);
								}

								// Add embed thumbnail to imageAttachments if present (and no main image)
								if (linkEmbedData.thumbnailInfo) {
									imageAttachments.push({
										url: linkEmbedData.thumbnailInfo.url,
										proxyUrl: linkEmbedData.thumbnailInfo.proxyUrl,
										mimeType: linkEmbedData.thumbnailInfo.mimeType,
										filename: linkEmbedData.thumbnailInfo.filename,
									});
									hasLocalMedia = true;
									log.info(
										`Added embed thumbnail from link preview: ${linkEmbedData.thumbnailInfo.filename}`,
									);
								}
							}
						}
					}
				}

				// Override author information for special message types
				if (hasProcessedEmbed) {
					// Processed embeds should appear as system/user messages
					effectiveAuthorId = "system-embed"; // Use a special system ID to prevent combination
					authorName = "System"; // Use "System" as the author name for processed embeds
					authorType = "user";
					personaName = null;
				} else if (isDebugMessage) {
					// Debug messages ($:) should appear as coming from the bot (model role)
					effectiveAuthorId = client.user?.id || "bot"; // Use bot's actual ID for debug messages
					authorName =
						mainPersona?.tomori_nickname ??
						tomoriState?.tomori_nickname ??
						"Bot"; // Keep bot nickname
					authorType = "persona";
					personaName =
						mainPersona?.tomori_nickname ??
						tomoriState?.tomori_nickname ??
						null;
				}

				// 5.a. Process direct image attachments and stickers
				if (msg.attachments.size > 0) {
					for (const attachment of msg.attachments.values()) {
						if (
							attachment.contentType?.startsWith("image/png") ||
							attachment.contentType?.startsWith("image/jpeg") ||
							attachment.contentType?.startsWith("image/webp") ||
							attachment.contentType?.startsWith("image/heic") ||
							attachment.contentType?.startsWith("image/heif") ||
							attachment.contentType?.startsWith("image/gif")
						) {
							imageAttachments.push({
								url: attachment.url,
								proxyUrl: attachment.proxyURL,
								mimeType: attachment.contentType,
								filename: attachment.name,
							});
							hasLocalMedia = true;
						}
						// 1. Check for video attachments using supported MIME types
						else if (
							attachment.contentType &&
							SUPPORTED_VIDEO_MIME_TYPES.some((type) =>
								attachment.contentType?.startsWith(type),
							)
						) {
							videoAttachments.push({
								url: attachment.url,
								proxyUrl: attachment.proxyURL,
								mimeType: attachment.contentType,
								filename: attachment.name,
								isYouTubeLink: false,
							});
							hasLocalMedia = true;
							log.info(
								`Processed video attachment: ${attachment.name} (${attachment.contentType})`,
							);
						}
					}
				}

				// Process stickers sent in the message
				if (msg.stickers.size > 0) {
					for (const sticker of msg.stickers.values()) {
						// Get the sticker URL for Lottie, PNG, or other formats
						// Discord CDN URL follows a consistent pattern
						const stickerUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.png`;

						imageAttachments.push({
							url: stickerUrl,
							proxyUrl: stickerUrl, // Use same URL for proxy
							mimeType: "image/png", // Discord serves PNG version for stickers
							filename: `${sticker.name}.png`,
						});
						hasLocalMedia = true;
						log.info(`Processed sticker: ${sticker.name} (${sticker.id})`);
					}
				}

				if (shouldExtractEmojiImages && msg.content) {
					const emojiAttachments = extractEmojiImageAttachments(msg.content);
					if (emojiAttachments.length > 0) {
						imageAttachments.push(...emojiAttachments);
						hasLocalMedia = true;
						log.info(
							`Processed ${emojiAttachments.length} emoji(s) from message ${msg.id}`,
						);
					}
				}

				// 2. Process YouTube links in message content
				if (msg.content) {
					for (const pattern of YOUTUBE_URL_PATTERNS) {
						const match = msg.content.match(pattern);
						if (match) {
							const youtubeUrl = match[0];
							const videoId = match[1];
							videoAttachments.push({
								url: youtubeUrl,
								proxyUrl: youtubeUrl, // YouTube links don't need proxy
								mimeType: "video/youtube", // Custom MIME type for YouTube
								filename: `youtube_video_${videoId}.mp4`,
								isYouTubeLink: true,
							});
							hasLocalMedia = true;
							log.info(`Detected YouTube link: ${youtubeUrl} (ID: ${videoId})`);
							break; // Only process the first YouTube link found to avoid duplicates
						}
					}
				}

				// 5.b. Check for Tenor GIF links in the message content
				// Can detect multiple Tenor URLs and works even with accompanying text
				// Note: We check regardless of existing attachments because Discord may have added a PNG preview
				if (msg.content) {
					// Use matchAll to find all Tenor URLs in the message
					const tenorMatches = Array.from(
						msg.content.matchAll(TENOR_GIF_REGEX),
					);

					if (tenorMatches.length > 0) {
						log.info(
							`Detected ${tenorMatches.length} Tenor GIF link(s) in msg ID ${msg.id}`,
						);

						// Process each Tenor URL found (typically just one)
						for (const match of tenorMatches) {
							const tenorViewUrl = match[0];

							// Ensure it's a complete URL (add https:// if missing)
							const fullUrl = tenorViewUrl.startsWith("http")
								? tenorViewUrl
								: `https://${tenorViewUrl}`;

							log.info(`Processing Tenor URL: ${fullUrl}`);

							// Resolve Tenor view URL to direct GIF CDN URL
							const directGifUrl = await resolveTenorUrl(fullUrl);

							if (directGifUrl) {
								// Determine if this is a GIF or video based on file extension
								const fileExt = directGifUrl.split(".").pop()?.toLowerCase();
								const isVideo =
									fileExt === "mp4" || fileExt === "webm" || fileExt === "mov";
								const isGif = fileExt === "gif";

								// Check if Discord already added a preview attachment for this Tenor URL
								// Discord proxy URLs look like: https://images-ext-1.discordapp.net/external/.../media.tenor.com/...png
								const discordTenorProxyIndex = imageAttachments.findIndex(
									(att) =>
										att.proxyUrl.includes("discordapp.net/external") &&
										att.proxyUrl.includes("media.tenor.com"),
								);

								if (isGif) {
									hasLocalMedia = true;
									// Handle as GIF (image with keyframe extraction)
									if (discordTenorProxyIndex !== -1) {
										// Replace Discord's PNG preview with our resolved GIF
										imageAttachments[discordTenorProxyIndex] = {
											url: directGifUrl,
											proxyUrl: directGifUrl,
											mimeType: "image/gif",
											filename: `tenor_${discordTenorProxyIndex + 1}.gif`,
										};
										log.success(
											`Replaced Discord Tenor preview with resolved GIF: ${directGifUrl}`,
										);
									} else {
										// No Discord preview found, add as new attachment
										imageAttachments.push({
											url: directGifUrl,
											proxyUrl: directGifUrl,
											mimeType: "image/gif",
											filename: `tenor_${imageAttachments.length + 1}.gif`,
										});
										log.success(
											`Successfully resolved Tenor URL to GIF: ${directGifUrl}`,
										);
									}
								} else if (isVideo) {
									hasLocalMedia = true;
									// Handle as video (for providers that support video like Gemini)
									// Remove Discord's preview if it exists since we're adding the actual video
									if (discordTenorProxyIndex !== -1) {
										imageAttachments.splice(discordTenorProxyIndex, 1);
									}

									// Determine video mimeType
									const videoMimeType =
										fileExt === "mp4"
											? "video/mp4"
											: fileExt === "webm"
												? "video/webm"
												: "video/quicktime"; // for .mov

									// Add as video attachment
									videoAttachments.push({
										url: directGifUrl,
										proxyUrl: directGifUrl,
										mimeType: videoMimeType,
										filename: `tenor_${videoAttachments.length + 1}.${fileExt}`,
										isYouTubeLink: false, // This is a direct Tenor video, not YouTube
									});
									log.success(
										`Successfully resolved Tenor URL to video (${videoMimeType}): ${directGifUrl}`,
									);
								} else {
									log.warn(
										`Unknown Tenor media format: ${fileExt}, keeping as text`,
									);
								}
							} else {
								log.warn(
									`Failed to resolve Tenor URL, keeping as text: ${fullUrl}`,
								);
							}
						}

						// Keep the Tenor URL(s) as text content since they often contain useful descriptive context
						// (e.g., "tsukimura-dark-souls-death-idolmaster" provides context about the GIF)
					}
				}

				const resolvedMediaSourceMessageId =
					imageAttachments.length > 0 || videoAttachments.length > 0
						? hasLocalMedia
							? msg.id
							: (mediaSourceMessageId ?? undefined)
						: undefined;

				// 5.c. Check if this message is from the same effective author as the previous one
				const prevMessage = simplifiedMessages[simplifiedMessages.length - 1];

				// 6. Check if the previous message was also a debug message
				const prevWasDebugMessage =
					prevMessage &&
					prevMessage.authorName === tomoriState?.tomori_nickname &&
					prevMessage.authorId !== client.user?.id; // Was debug message if it shows as Tomori but isn't actually from the bot

				// 7. Only combine messages from the same "effective author"
				// This prevents combining debug messages ($:) with regular messages from the same user
				// and prevents combining processed embed messages with other messages
				const isSameEffectiveAuthor =
					prevMessage &&
					prevMessage.authorId === effectiveAuthorId &&
					prevWasDebugMessage === isDebugMessage;

				// 5.d. Determine if we should combine with the previous message or create a new entry
				if (
					isSameEffectiveAuthor &&
					messageContentForLlm &&
					prevMessage.content
				) {
					// Append this message's content to the previous message with a newline
					prevMessage.content += `\n${messageContentForLlm}`; // If this message has images, add them to the previous message's images
					if (imageAttachments.length > 0) {
						prevMessage.imageAttachments = [
							...prevMessage.imageAttachments,
							...imageAttachments,
						];
					}
					// If this message has videos, add them to the previous message's videos
					if (videoAttachments.length > 0) {
						prevMessage.videoAttachments = [
							...prevMessage.videoAttachments,
							...videoAttachments,
						];
					}
					if (resolvedMediaSourceMessageId) {
						prevMessage.mediaSourceMessageId = resolvedMediaSourceMessageId;
					}
				} else if (
					messageContentForLlm ||
					imageAttachments.length > 0 ||
					videoAttachments.length > 0
				) {
					// Create a new entry if it's a different author or the previous has no content
					simplifiedMessages.push({
						id: msg.id,
						authorId: effectiveAuthorId,
						authorName,
						authorType,
						personaName,
						content: messageContentForLlm,
						mediaSourceMessageId: resolvedMediaSourceMessageId,
						imageAttachments,
						videoAttachments,
					});
				}
			}

			// Always add the bot's own ID to userList so it appears in context with its User ID
			if (client.user?.id) {
				userListSet.add(client.user.id);
			}

			const userList = Array.from(userListSet);
			const channelName = isDMChannel
				? "Direct Message"
				: "name" in channel
					? channel.name
					: "Unknown Channel";
			const channelDesc = isDMChannel
				? null
				: "topic" in channel
					? channel.topic
					: null;
			const serverName = isDMChannel
				? "Direct Message"
				: guild?.name || "Unknown Server";
			const serverDescription = isDMChannel ? null : guild?.description;

			// ========== MULTI-PERSONA RESPONSE LOOP START ==========
			// Each persona will generate a response sequentially using the same message history
			// but with their own personality, config, and (for alters) webhook avatar
			for (
				let personaIndex = 0;
				personaIndex < personasToRespond.length;
				personaIndex++
			) {
				const currentPersona = personasToRespond[personaIndex];
				const personaSnapshot: RequestSnapshot = {
					...requestSnapshot,
					tomoriState: currentPersona,
				};
				log.info(
					`Starting response ${personaIndex + 1}/${personasToRespond.length} from persona "${currentPersona.tomori_nickname}" (${currentPersona.is_alter ? "alter" : "main"})`,
				);

				// Assign currentPersona to tomoriState for this iteration
				// This allows all existing code to work without modification
				tomoriState = currentPersona;

				// Send typing indicator for each persona response
				if (personaIndex > 0) {
					await channel.sendTyping();
				}

				try {
					// Persona-specific response generation starts here

					let emojiStrings: string[] = [];
					let loadedEmojis: ServerEmojiRow[] | null = null;
					let loadedStickers: ServerStickerRow[] | null = null;

					// Load emojis and stickers from 5-minute in-memory cache (lazy sync included)
					if (!isDMChannel && guild && currentPersona.server_id) {
						const { emojis, stickers } = await loadEmojiStickerCache(
							tomoriState.server_id,
							guild,
							tomoriState.config.emoji_usage_enabled,
							tomoriState.config.sticker_usage_enabled,
						);

						loadedEmojis = emojis;
						loadedStickers = stickers;

						// Process emojis for conversion (if emoji usage is enabled)
						if (
							tomoriState.config.emoji_usage_enabled &&
							emojis &&
							emojis.length > 0
						) {
							// Sort emojis by created_at timestamp, then by ID
							const sortedEmojis = [...emojis].sort((a, b) => {
								const rawATime = a.created_at
									? new Date(a.created_at).getTime()
									: 0;
								const rawBTime = b.created_at
									? new Date(b.created_at).getTime()
									: 0;
								const aTime = Number.isNaN(rawATime) ? 0 : rawATime;
								const bTime = Number.isNaN(rawBTime) ? 0 : rawBTime;
								if (aTime !== bTime) return aTime - bTime;
								const aId = a.server_emoji_id ?? 0;
								const bId = b.server_emoji_id ?? 0;
								if (aId !== bId) return aId - bId;
								return a.emoji_disc_id.localeCompare(b.emoji_disc_id);
							});

							// Convert to Discord emoji string format
							emojiStrings = sortedEmojis.map(
								(e) =>
									`<${e.is_animated ? "a" : ""}:${e.emoji_name}:${e.emoji_disc_id}>`,
							);

							// Debug: Log loaded emoji count and sample
							log.info(
								`[Emoji Load] Loaded ${emojiStrings.length} emojis from cache. Sample: ${emojiStrings
									.slice(0, 5)
									.map((e) => e.match(/:[^:]+:/)?.[0])
									.join(", ")}`,
							);
						}
					}

					// Inject reminder into conversation history if needed
					// This makes the reminder part of the natural conversation flow rather than system injection
					if (reminderRecipientID && reminderData) {
						let reminderContent = `[A reminder you have set before for <@${reminderRecipientID}> (Mention ID: ${reminderRecipientID}) has been triggered. The reminder is about: "${reminderData.reminder_purpose}"]`;

						if (reminderData.reminder_lateness) {
							reminderContent += ` [You are also ${reminderData.reminder_lateness} to remind the user.]`;
						}

						// Create synthetic simplified message for the reminder
						const reminderMessage: SimplifiedMessageForContext = {
							id: `synthetic-reminder-${Date.now()}`, // Synthetic ID for system-generated reminder
							authorId: reminderRecipientID,
							authorName: "System", // Use bot's nickname
							authorType: "user",
							personaName: null,
							content: reminderContent,
							imageAttachments: [],
							videoAttachments: [],
						};

						// Add to end of conversation history so it gets processed naturally
						simplifiedMessages.push(reminderMessage);
						log.info(
							`Injected reminder into conversation history for user ${reminderRecipientID} - will be processed by buildContext`,
						);
					}

					// Inject continuation prompt for manual triggers when the selected persona is the last speaker
					// This fixes the UX issue where manual /bot respond or /bot reason commands
					// don't work if the selected persona was the last one to speak in the conversation
					// IMPORTANT: Skip this for reasoning queries - they have their own system message
					if (
						isManuallyTriggered &&
						!reasoningQuery &&
						simplifiedMessages.length > 0
					) {
						const lastMessage =
							simplifiedMessages[simplifiedMessages.length - 1];

						// 1. Check if the last message is from a persona
						const isFromPersona = lastMessage.authorType === "persona";

						// 2. Check if the last message is from the SELECTED persona (for alter support)
						const selectedPersonaNickname =
							selectedPersona?.tomori_nickname?.toLowerCase();
						const lastMessagePersonaNickname =
							lastMessage.personaName?.toLowerCase();
						const isFromSelectedPersona =
							isFromPersona &&
							selectedPersonaNickname &&
							lastMessagePersonaNickname === selectedPersonaNickname;

						// 3. Check if the last message contains embeds (skip continuation for embeds)
						const isEmbedMessage =
							lastMessage.content?.includes(
								"[The following is a system-produced embed]",
							) ?? false;

						// 4. Only inject continuation if:
						//    - Last message is from the selected persona
						//    - Last message is NOT an embed
						if (isFromSelectedPersona && !isEmbedMessage) {
							log.info(
								`Manual trigger detected with ${selectedPersona?.tomori_nickname} as last speaker - injecting continuation prompt for UX`,
							);

							// Create a fake user message prompting the persona to continue
							// Use "0" as authorId to ensure it's not the bot's ID (will be labeled as "user" role)
							const continuationPrompt: SimplifiedMessageForContext = {
								id: `synthetic-continuation-${Date.now()}`, // Synthetic ID for system-generated continuation
								authorId: "0", // Placeholder ID that's definitely not the bot's ID
								authorName: "System",
								authorType: "user",
								personaName: null,
								content: "[Continue your last message]",
								imageAttachments: [],
								videoAttachments: [],
							};

							// Add the continuation prompt to the conversation history
							simplifiedMessages.push(continuationPrompt);
							log.info(
								`Injected continuation prompt as System user to allow ${selectedPersona?.tomori_nickname} to respond`,
							);
						}
					}

					// 11. Build Context
					// The `buildContext` function will be refactored in a subsequent step to accept
					// `simplifiedMessages` and produce `StructuredContextItem[]`.
					// For now, its signature and output type (ContextSegment[]) remain, but we pass the new data.
					let contextSegments: StructuredContextItem[] = [];
					try {
						// NOTE: The `buildContext` call signature will change.
						// It will take `simplifiedMessageHistory: simplifiedMessages` instead of `conversationHistory`.
						// It will also need `tomoriNickname`, `tomoriAttributes`, and `tomoriConfig` to build system instructions.
						contextSegments = await buildContext({
							guildId: serverDiscId,
							serverName,
							serverDescription: serverDescription ?? null,
							// conversationHistory: conversationHistory, // This parameter will be removed
							simplifiedMessageHistory: simplifiedMessages, // New parameter for structured history
							userList,
							channelDesc,
							channelName,
							client,
							triggererName,
							emojiStrings,
							// Use the current persona nickname so role mapping and samples match the responding persona
							tomoriNickname: // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked
								currentPersona.tomori_nickname ?? tomoriState!.tomori_nickname,
							// biome-ignore lint/style/noNonNullAssertion: tomoriState is checked
							tomoriAttributes: tomoriState!.attribute_list,
							// biome-ignore lint/style/noNonNullAssertion: tomoriState is checked
							tomoriConfig: tomoriState!.config,
							isDMChannel, // Pass DM channel flag for proper context building
							snapshot: personaSnapshot, // Use persona-specific snapshot for correct context
							preloadedEmojis: loadedEmojis, // Pass pre-loaded emoji data to avoid redundant DB query
							preloadedStickers: loadedStickers, // Pass pre-loaded sticker data to avoid redundant DB query
						});

						// Apply emoji repetition penalty if bot has been using too many emojis
						contextSegments = applyEmojiPenaltyIfNeeded(
							contextSegments,
							tomoriState?.tomori_nickname ??
								process.env.DEFAULT_BOTNAME ??
								"Tomori",
						);

						// Inject system context for stop responses
						if (isStopResponse) {
							// Find the last user message in context and replace/supplement it with system context
							let lastUserContextIndex = -1;
							for (let i = contextSegments.length - 1; i >= 0; i--) {
								if (contextSegments[i].role === "user") {
									lastUserContextIndex = i;
									break;
								}
							}

							if (lastUserContextIndex !== -1) {
								// Replace the last user message content with system context
								const lastUserContext = contextSegments[lastUserContextIndex];
								const originalContent = lastUserContext.parts
									.filter((part) => part.type === "text")
									.map((part) => (part as { type: "text"; text: string }).text)
									.join(" ");

								// Replace text parts with system context, preserve other parts (images, etc.)
								const nonTextParts = lastUserContext.parts.filter(
									(part) => part.type !== "text",
								);
								lastUserContext.parts = [
									{
										type: "text",
										text: `[System: The user has requested you to stop your current generation. Original message: "${originalContent}"]`,
									},
									...nonTextParts,
								];

								log.info(
									`Replaced last user message with system stop context. Original content: "${originalContent}"`,
								);
							} else {
								// Fallback: add as new context item if no user message found
								const systemStopContext: StructuredContextItem = {
									role: "user",
									parts: [
										{
											type: "text",
											text: "[System: The user has requested you to stop your current generation]",
										},
									],
									metadataTag: ContextItemTag.DIALOGUE_HISTORY,
								};
								contextSegments.push(systemStopContext);
								log.info(
									"Added system stop context as new message (no user context found)",
								);
							}
						}

						// Inject reasoning query as user message in dialogue if provided
						if (reasoningQuery) {
							// Add reasoning query as a user message in the conversation dialogue
							const reasoningUserMessage: StructuredContextItem = {
								role: "user",
								parts: [
									{
										type: "text",
										text: `[System: The user has activated reasoning mode with the following query: "${reasoningQuery}". Please provide a thoughtful, well-reasoned response to this query.]`,
									},
								],
								metadataTag: ContextItemTag.DIALOGUE_HISTORY,
							};
							contextSegments.push(reasoningUserMessage);
							log.info(
								`Injected reasoning query as user message in dialogue: "${reasoningQuery}"`,
							);
						}
					} catch (error) {
						log.error("Error building context for LLM API Call:", error, {
							serverId: tomoriState?.server_id, // Use internal DB ID if available
							errorType: "ContextBuildingError",
							metadata: {
								guildId: serverDiscId,
								channelName: channelName, // Use the channelName variable we already calculated
								userCountInContext: userList.length,
							},
						});
						await sendStandardEmbed(channel, locale, {
							color: ColorCode.ERROR,
							titleKey: "general.errors.context_error_title",
							descriptionKey: "general.errors.context_error_description",
							footerKey: "genai.generic_error_footer",
						});
						return;
					}
					// API Key Selection with Rotation Support
					// 1. Check if rotation is active (2+ keys in pool)
					// 2. If active, use round-robin selection with cooldown filtering
					// 3. If not active or all keys exhausted, fall back to main key
					let decryptedApiKey: string;
					let selectedKeyResult: SelectedKeyResult | null = null;

					// biome-ignore lint/style/noNonNullAssertion: tomoriState is checked earlier
					const rotationActive = (tomoriState!.rotation_keys?.length ?? 0) >= 2;

					if (rotationActive) {
						// Try to select a key from the rotation pool
						// biome-ignore lint/style/noNonNullAssertion: tomoriState is checked earlier
						selectedKeyResult = await selectApiKey(tomoriState!, []);

						if (selectedKeyResult) {
							decryptedApiKey = selectedKeyResult.apiKey;
							log.info(
								`Using rotation key ${selectedKeyResult.rotationKeyId} (main: ${selectedKeyResult.isMainKey}) for server ${tomoriState?.server_id}`,
							);
						} else {
							// All rotation keys exhausted or in cooldown, fall back to main key
							log.warn(
								`All rotation keys exhausted for server ${tomoriState?.server_id}, falling back to main key`,
							);
							// biome-ignore lint/style/noNonNullAssertion: API key presence was validated earlier
							const keyVersion = tomoriState!.config.key_version || 1;
							decryptedApiKey = await decryptApiKey(
								// biome-ignore lint/style/noNonNullAssertion: API key presence was validated earlier
								tomoriState!.config.api_key!,
								keyVersion,
							);
						}
					} else {
						// No rotation active, use main key directly
						// biome-ignore lint/style/noNonNullAssertion: API key presence was validated earlier for triggered messages, tomoriState is checked
						const keyVersion = tomoriState!.config.key_version || 1; // Default to V1 for backward compatibility
						decryptedApiKey = await decryptApiKey(
							// biome-ignore lint/style/noNonNullAssertion: API key presence was validated earlier for triggered messages, tomoriState is checked
							tomoriState!.config.api_key!,
							keyVersion,
						);

						// LAZY ROTATION: If using old key version, re-encrypt with current version
						const currentVersion = keyManager.getCurrentVersion();
						if (keyVersion !== currentVersion) {
							log.info(
								`Rotating main API key from version ${keyVersion} to ${currentVersion} for server ${tomoriState?.server_id}`,
							);

							try {
								const { encryptApiKey } = await import(
									"@/utils/security/crypto"
								);
								const { encrypted, version } =
									await encryptApiKey(decryptedApiKey);

						await sql`
							UPDATE tomori_configs
							SET api_key = ${encrypted},
							    key_version = ${version},
							    updated_at = CURRENT_TIMESTAMP
							WHERE server_id = ${tomoriState?.server_id}
						`;

								log.success(
									`Main API key rotation completed for server ${tomoriState?.server_id}`,
								);

								// Update in-memory state to reflect the new version
								// biome-ignore lint/style/noNonNullAssertion: tomoriState is checked earlier
								tomoriState!.config.api_key = encrypted;
								// biome-ignore lint/style/noNonNullAssertion: tomoriState is checked earlier
								tomoriState!.config.key_version = version;
							} catch (error) {
								log.warn(
									"Failed to rotate main API key (non-critical - will retry on next message)",
									error,
								);
								// Continue execution - the old key still works
							}
						}
					}

					if (!decryptedApiKey) {
						log.error("API Key is not set or failed to decrypt.", undefined, {
							serverId: tomoriState?.server_id,
							errorType: "ApiKeyError",
						});
						await sendStandardEmbed(channel, locale, {
							color: ColorCode.ERROR,
							titleKey: "general.errors.api_key_error_title",
							descriptionKey: "general.errors.api_key_error_description",
						});
						return;
					}

					// 12. Generate Response - Get provider instance

					// Get the appropriate provider based on TomoriState configuration
					let provider: LLMProvider;
					try {
						provider = await getProviderForTomori(tomoriState);
					} catch (error) {
						log.error(
							`Failed to get LLM provider: ${error instanceof Error ? error.message : String(error)}`,
							error as Error,
							{
								serverId: tomoriState?.server_id,
								errorType: "ProviderError",
								metadata: {
									configuredProvider: tomoriState?.llm.llm_provider,
									configuredModel: tomoriState?.llm.llm_codename,
								},
							},
						);
						await sendStandardEmbed(channel, locale, {
							color: ColorCode.ERROR,
							titleKey: "general.errors.provider_not_supported_title",
							descriptionKey:
								"general.errors.provider_not_supported_description",
							descriptionVars: {
								provider: tomoriState?.llm.llm_provider || "unknown",
							},
						});
						return;
					}

					// Create provider-specific configuration
					// If model override is specified, temporarily modify tomoriState
					let originalModelCodename: string | undefined;
					if (llmOverrideCodename) {
						originalModelCodename = tomoriState.llm.llm_codename;
						tomoriState.llm.llm_codename = llmOverrideCodename;
						log.info(
							`Overriding model from ${originalModelCodename} to ${llmOverrideCodename} for manual command`,
						);
					}

					const providerConfig = await provider.createConfig(
						tomoriState,
						decryptedApiKey,
					);

					// Restore original model if it was overridden
					if (originalModelCodename) {
						tomoriState.llm.llm_codename = originalModelCodename;
					}

					log.info(
						"Streaming mode enabled. Attempting to stream response to Discord.",
					);

					// 1. Initialize variables for the function calling loop in streaming mode
					let selectedStickerToSend: Sticker | null = null;
					const functionInteractionHistory: {
						functionCall: FunctionCall;
						functionResponse: Record<string, unknown>;
					}[] = [];
					let finalStreamCompleted = false;
					const accumulatedStreamedModelParts: Array<Record<string, unknown>> =
						[];

					for (let i = 0; i < MAX_FUNCTION_CALL_ITERATIONS; i++) {
						log.info(
							`Streaming LLM Call Iteration: ${i + 1}/${MAX_FUNCTION_CALL_ITERATIONS}. History items: ${functionInteractionHistory.length}`,
						);

						try {
							// Debug: Log final context right before sending to LLM
							if (reminderRecipientID) {
								for (
									let i = Math.max(0, contextSegments.length - 3);
									i < contextSegments.length;
									i++
								) {
									const segment = contextSegments[i];
									const textParts = segment.parts
										.filter((p) => p.type === "text")
										.map((p) => (p as { type: "text"; text: string }).text)
										.join(" ");
									log.info(
										`  [${i}] ${segment.role}: ${textParts.substring(0, 100)}${textParts.length > 100 ? "..." : ""}`,
									);
								}
								// Show the complete last segment if it's the system message
								const lastSegment = contextSegments[contextSegments.length - 1];
								if (lastSegment.role === "user") {
									const fullText = lastSegment.parts
										.filter((p) => p.type === "text")
										.map((p) => (p as { type: "text"; text: string }).text)
										.join(" ");
									if (fullText.includes("[System:")) {
										log.info(`Complete system message: ${fullText}`);
									}
								}
							}

							// Resolve persona webhook and avatar/username for webhook-based sending
							// Only use webhook for alter personas (not main) in guild channels (not DMs)
							let personaWebhook = channelWebhook;
							if (
								usePersonaWebhooks &&
								supportsWebhooks &&
								currentPersona.is_alter
							) {
								const webhookResult = await getOrCreatePersonaWebhook(
									channel as TextChannel,
									currentPersona,
								);
								personaWebhook = webhookResult.webhook;
								if (
									!personaWebhook &&
									webhookResult.errorReason &&
									!webhookErrorNotified
								) {
									await sendWebhookErrorEmbed(
										channel,
										locale,
										webhookResult.errorReason,
									);
									webhookErrorNotified = true;
								}
							}

							const personaAvatarUrl =
								personaWebhook &&
								guild &&
								currentPersona.is_alter &&
								!usePersonaWebhooks
									? resolvePersonaAvatarURL(currentPersona, guild)
									: undefined;

							const personaUsername =
								personaWebhook && currentPersona.is_alter
									? currentPersona.tomori_nickname
									: undefined;

							// Create isolated copies for each persona to prevent context pollution
							const personaAccumulatedParts = [
								...accumulatedStreamedModelParts,
							];
							const personaFunctionHistory = [...functionInteractionHistory];

							const streamProviderPromise = await provider.streamToDiscord(
								channel,
								client,
								// biome-ignore lint/style/noNonNullAssertion: Missing Tomoristate handled at start of TomoriChat
								tomoriState!,
								providerConfig,
								contextSegments, // Can be shared (read-only message history)
								personaAccumulatedParts, // Isolated per persona
								emojiStrings,
								personaFunctionHistory.length > 0
									? personaFunctionHistory
									: undefined, // Isolated per persona
								undefined,
								isFromQueue ? message : undefined,
								streamingContext, // Pass streaming context for context-aware tool availability
								locale, // Pass user's preferred locale for error messages
								personaWebhook ?? undefined, // Pass webhook for alter persona avatar support
								personaAvatarUrl, // Pass resolved avatar URL
								personaUsername, // Pass persona username
							);
							const timeoutPromise = new Promise<never>(
								(
									_,
									reject, // Promise<never> indicates it only rejects
								) =>
									setTimeout(
										() =>
											reject(
												new Error(
													"SDK_CALL_TIMEOUT: provider streamToDiscord call timed out.",
												),
											),
										STREAM_SDK_CALL_TIMEOUT_MS,
									),
							);

							let streamResult: StreamResult;
							try {
								// Promise.race will settle as soon as one of the promises settles
								streamResult = await Promise.race([
									streamProviderPromise,
									timeoutPromise,
								]);
							} catch (raceError) {
								// This catch block will execute if timeoutPromise rejects first,
								// or if streamProviderPromise itself rejects *before* the timeout.
								if (
									raceError instanceof Error &&
									raceError.message.startsWith("SDK_CALL_TIMEOUT:")
								) {
									log.error(
										`Provider streamToDiscord call timed out for channel ${channel.id}.`,
										raceError, // Log the timeout error
										{
											serverId: tomoriState?.server_id,
											errorType: "SDKTimeoutError",
										},
									);
									await sendStandardEmbed(channel, locale, {
										color: ColorCode.ERROR, // Using ERROR as it's a more critical failure
										titleKey: "genai.error_stream_timeout_title", // New locale key
										descriptionKey: "genai.error_stream_timeout_description", // New locale key
									});
									finalStreamCompleted = true; // Consider it "completed" to break the loop
									break;
								}
								// If it's not our specific timeout error, re-throw to be caught by the outer catch
								throw raceError;
							}

							// Use switch statement for exhaustive status checking
							switch (streamResult.status) {
								case "completed":
									log.success("Streaming to Discord completed successfully.");
									// Record success for rotation key if one was used
									if (selectedKeyResult?.rotationKeyId) {
										await recordKeySuccess(selectedKeyResult.rotationKeyId);
									}
									finalStreamCompleted = true;
									break; // Exit loop, final text stream was handled by streamGeminiToDiscord

								case "error": {
									log.error(
										"Streaming to Discord reported an error.",
										streamResult.data,
										{
											serverId: tomoriState?.server_id,
											errorType: "StreamingError",
										},
									);
									// Record error for rotation key if one was used and error is key-related
									if (selectedKeyResult?.rotationKeyId && streamResult.data) {
										// Check if error is API key related (rate limit or auth error)
										const errorData = streamResult.data as {
											type?: string;
											message?: string;
											code?: string;
										};
										if (errorData.type === "rate_limit") {
											await recordKeyError(
												selectedKeyResult.rotationKeyId,
												"rate_limit",
												errorData.message || "Rate limit exceeded",
											);
										} else if (
											errorData.type === "api_error" ||
											errorData.code === "401" ||
											errorData.code === "403"
										) {
											await recordKeyError(
												selectedKeyResult.rotationKeyId,
												"api_error",
												errorData.message || "API authentication error",
											);
										}
									}
									// streamGeminiToDiscord already attempts to send an error message.
									finalStreamCompleted = true; // Consider it "completed" to break loop, error handled.
									break;
								}

								case "empty_response": {
									// Handle empty response with fresh context retry
									const MAX_EMPTY_RESPONSE_RETRIES = 2;
									const RETRY_DELAY_MS = 1000;

									if (retryCount < MAX_EMPTY_RESPONSE_RETRIES) {
										log.info(
											`Empty response detected (attempt ${retryCount + 1}/${MAX_EMPTY_RESPONSE_RETRIES + 1}). Retrying with fresh context in ${RETRY_DELAY_MS}ms...`,
										);

										// Wait before retry
										await new Promise((resolve) =>
											setTimeout(resolve, RETRY_DELAY_MS),
										);

										// Recursive call with fresh context (skipLock=true to avoid semaphore issues)
										return await tomoriChat(
											client,
											message,
											isFromQueue,
											true, // isManuallyTriggered - bypass trigger checks for retry
											forceReason,
											reasoningQuery,
											llmOverrideCodename,
											isStopResponse,
											retryCount + 1, // Increment retry count
											true, // skipLock - parent already holds the lock
											reminderRecipientID,
											reminderData,
											selectedPersonaId,
											isPersonaJob,
										);
									} else {
										// Max retries reached, show error embed
										log.warn(
											`Empty response after ${MAX_EMPTY_RESPONSE_RETRIES} retries. Showing error embed.`,
										);

										await sendStandardEmbed(channel, locale, {
											titleKey: "genai.empty_response_title",
											descriptionKey: "genai.empty_response_description",
											color: ColorCode.WARN,
											footerKey: "genai.generic_error_footer",
										}).catch((e) =>
											log.warn(
												"Failed to send empty response embed to channel",
												e,
											),
										);

										finalStreamCompleted = true; // Mark as completed to exit
										break;
									}
								}

								case "timeout":
									// This is the internal stream inactivity timeout from streamGeminiToDiscord
									log.warn(
										`Streaming to Discord timed out due to inactivity for channel ${channel.id}.`,
										streamResult.data,
									);
									await sendStandardEmbed(channel, locale, {
										color: ColorCode.WARN,
										titleKey: "genai.error_stream_timeout_title",
										descriptionKey: "genai.error_stream_timeout_description",
									});
									finalStreamCompleted = true;
									break;

								case "stopped_by_user": {
									// Handle user-requested stop (natural stop triggers)
									log.info(
										`Streaming was stopped by user request for channel ${channel.id}.`,
									);
									finalStreamCompleted = true;

									// Check if we have stop context to create a response
									const stopContext = StreamOrchestrator.getAndClearStopContext(
										channel.id,
									);

									if (stopContext) {
										// Get the current lock entry to queue the stop response
										const currentLockEntry = channelLocks.get(channel.id);
										if (currentLockEntry) {
											// Queue the original stop message as a "passport" for stop response
											currentLockEntry.messageQueue.unshift({
												message: stopContext.originalStopMessage,
												isManuallyTriggered: true, // This bypasses normal trigger logic
												forceReason: false,
												llmOverrideCodename,
												isStopResponse: true, // This response cannot be stopped
											});

											log.info(
												`Stop response queued after stream completion for channel ${channel.id}. Queue size: ${currentLockEntry.messageQueue.length}`,
											);
										}
									}

									break; // Exit the loop gracefully, stop response will be handled by queue
								}

								case "function_call": {
									if (!streamResult.data) {
										// Function call without data - log error and break
										log.error(
											"Function call status received without data:",
											streamResult,
										);
										finalStreamCompleted = true;
										break;
									}
									const funcCall = streamResult.data as FunctionCall; // Type assertion
									const funcName = funcCall.name?.trim() ?? "";
									log.info(
										`Stream LLM wants to call function: ${funcName} with args: ${JSON.stringify(funcCall.args)}`,
									);

									// 2. Execute function using modular tool system
									log.info(
										`Executing tool: ${funcName} with args: ${JSON.stringify(funcCall.args)}`,
									);

									// Build tool execution context
									const toolContext = {
										channel,
										client,
										message,
										userId: userRow?.user_id?.toString() || userDiscId,
										guildId: message.guild?.id, // Pass guild ID for guild-specific features (e.g., server avatars)
										tomoriState,
										locale,
										provider: provider.getInfo().name,
										streamContext: streamingContext, // Pass streaming context to tools
									};

									// Execute tool using ToolRegistry (handles both built-in and MCP tools seamlessly)
									// Check for stop request before executing function call
									if (StreamOrchestrator.hasStopRequest(channel.id)) {
										log.info(
											`Function call execution cancelled due to stop request: ${funcName}`,
										);
										finalStreamCompleted = true;
										break;
									}

									const functionCallStart = Date.now();
									const toolResult = await ToolRegistry.executeTool(
										funcName,
										funcCall.args || {},
										toolContext,
									);
									const functionCallDuration = Date.now() - functionCallStart;

									// Log function call timing (especially long-running ones)
									if (functionCallDuration > 5000) {
										log.warn(
											`Long-running function call: ${funcName} took ${functionCallDuration}ms`,
										);
									} else {
										log.info(
											`Function call completed: ${funcName} (${functionCallDuration}ms)`,
										);
									}

									// Convert tool result to function execution result format
									let functionExecutionResult: Record<string, unknown>;

									if (toolResult.success) {
										functionExecutionResult = (toolResult.data as Record<
											string,
											unknown
										>) || { status: "completed" };

										// Handle sticker selection specifically (extract sticker for later sending)
										if (
											funcName === "select_sticker_for_response" &&
											toolResult.data
										) {
											const stickerData = toolResult.data as Record<
												string,
												unknown
											>;
											if (
												stickerData.status === "sticker_selected_successfully"
											) {
												// Find the sticker in guild cache to send later
												const discordSticker = guild?.stickers.cache.get(
													stickerData.sticker_id as string,
												);
												selectedStickerToSend = discordSticker || null;
												log.success(
													`Sticker '${stickerData.sticker_name}' selected for sending`,
												);
											} else {
												selectedStickerToSend = null;
											}
										}

										// Handle YouTube video restart signal (enhanced context restart)
										if (
											funcName === "process_youtube_video" &&
											toolResult.data &&
											(toolResult.data as Record<string, unknown>).type ===
												"context_restart_with_video"
										) {
											const restartData = toolResult.data as Record<
												string,
												unknown
											>;
											const enhancedContextItem =
												restartData.enhanced_context_item as StructuredContextItem;
											const videoUrl = restartData.video_url as string;
											const videoId = restartData.video_id as string;

											log.info(
												`YouTube video restart signal detected for: ${videoUrl}. Cleaning URLs and enhancing context.`,
											);

											// Set flag to disable YouTube processing during enhanced context restart
											// This prevents TomoriBot from making additional YouTube function calls while processing
											streamingContext.disableYouTubeProcessing = true;
											log.info(
												"Temporarily disabled YouTube processing function during enhanced context restart",
											);

											// Clean YouTube URLs from all existing context text parts FIRST to prevent false duplication detection
											for (const contextItem of contextSegments) {
												for (const part of contextItem.parts) {
													if (part.type === "text") {
														const originalText = part.text;
														part.text = removeYouTubeUrls(part.text, "");
														if (originalText !== part.text) {
															log.info(
																`Cleaned YouTube URLs from context text during duplication check. Original length: ${originalText.length}, cleaned length: ${part.text.length}`,
															);
														}
													}
												}
											}

											// Check for existing video parts with same video ID to prevent duplication
											// Only check actual video Parts, not text mentions (which are now cleaned)
											const existingVideoIds = new Set<string>();
											for (const contextItem of contextSegments) {
												for (const part of contextItem.parts) {
													// Check for enhanced context YouTube video parts specifically
													if (
														part.type === "video" &&
														part.uri &&
														"isYouTubeLink" in part &&
														(part as { isYouTubeLink: boolean })
															.isYouTubeLink &&
														"enhancedContext" in part &&
														(part as { enhancedContext: boolean })
															.enhancedContext
													) {
														const existingIds = extractYouTubeVideoIds(
															part.uri,
														);
														for (const id of existingIds) {
															existingVideoIds.add(id);
														}
													}
												}
											}

											// Only add video part if not already present
											if (!existingVideoIds.has(videoId)) {
												// Add the video context item to existing context
												contextSegments.push(enhancedContextItem);
												log.success(
													`Enhanced context with YouTube video Part (ID: ${videoId}). Total context items: ${contextSegments.length}`,
												);
											} else {
												log.warn(
													`YouTube video ${videoId} already exists in context. Skipping duplication.`,
												);
											}

											// Continue to next iteration WITHOUT adding to function interaction history
											// This will restart the streaming with enhanced context
											continue;
										}

										// Handle profile picture restart signal (enhanced context restart)
										if (
											funcName === "peek_profile_picture" &&
											toolResult.data &&
											(toolResult.data as Record<string, unknown>).type ===
												"context_restart_with_image"
										) {
											const restartData = toolResult.data as Record<
												string,
												unknown
											>;
											const userId = restartData.user_id as string;
											const username = restartData.username as string;

											log.info(
												`Profile picture restart signal detected for user: ${username} (${userId}). Enhancing context with avatar image.`,
											);

											// Get the enhanced context item from external storage
											const enhancedContextItem =
												PeekProfilePictureTool.getPendingEnhancedContext(
													userId,
												);

											if (!enhancedContextItem) {
												log.warn(
													`No pending enhanced context found for user ${userId}. Profile picture restart failed.`,
												);
												continue;
											}

											// Set flag to disable profile picture processing during enhanced context restart
											// This prevents TomoriBot from making additional profile picture function calls while processing
											streamingContext.disableProfilePictureProcessing = true;
											log.info(
												"Temporarily disabled profile picture processing function during enhanced context restart",
											);

											// Check for existing profile picture parts for this user to prevent duplication
											let hasExistingProfilePicture = false;
											for (const contextItem of contextSegments) {
												for (const part of contextItem.parts) {
													// Check for enhanced context profile picture parts specifically
													if (
														part.type === "image" &&
														"isProfilePicture" in part &&
														(part as { isProfilePicture: boolean })
															.isProfilePicture &&
														"enhancedContext" in part &&
														(part as { enhancedContext: boolean })
															.enhancedContext
													) {
														hasExistingProfilePicture = true;
														break;
													}
												}
												if (hasExistingProfilePicture) break;
											}

											// Only add profile picture part if not already present
											if (!hasExistingProfilePicture) {
												// Add the profile picture context item to existing context
												contextSegments.push(enhancedContextItem);
												log.success(
													`Enhanced context with profile picture for user: ${username}. Total context items: ${contextSegments.length}`,
												);
											} else {
												log.warn(
													`Profile picture for user ${username} already exists in context. Skipping duplication.`,
												);
											}

											// Continue to next iteration WITHOUT adding to function interaction history
											// This will restart the streaming with enhanced context
											continue;
										}

										// Handle GIF processing restart signal (enhanced context restart)
										if (
											funcName === "process_gif" &&
											toolResult.data &&
											(toolResult.data as Record<string, unknown>).type ===
												"context_restart_with_gif"
										) {
											const restartData = toolResult.data as Record<
												string,
												unknown
											>;
											const messageId = restartData.message_id as string;
											const frameCount = restartData.frame_count as number;

											log.info(
												`GIF processing restart signal detected for message: ${messageId} (${frameCount} frames). Enhancing context with GIF keyframes.`,
											);

											// Get the enhanced context item from external storage
											const enhancedContextItem =
												ProcessGifTool.getPendingEnhancedContext(messageId);

											if (!enhancedContextItem) {
												log.warn(
													`No pending enhanced context found for message ${messageId}. GIF restart failed.`,
												);
												continue;
											}

											// Set flag to disable GIF processing during enhanced context restart
											// This prevents TomoriBot from making additional GIF function calls while processing
											streamingContext.disableGifProcessing = true;
											log.info(
												"Temporarily disabled GIF processing function during enhanced context restart",
											);

											// Add the GIF frames context item to existing context
											contextSegments.push(enhancedContextItem);
											log.success(
												`Enhanced context with ${frameCount} GIF keyframes for message: ${messageId}. Total context items: ${contextSegments.length}`,
											);

											// Continue to next iteration WITHOUT adding to function interaction history
											// This will restart the streaming with enhanced context
											continue;
										}

										// Handle media context expansion restart signal (enhanced context restart)
										if (
											funcName === "increase_media_context" &&
											toolResult.data &&
											(toolResult.data as Record<string, unknown>).type ===
												"context_restart_with_media"
										) {
											const restartData = toolResult.data as Record<
												string,
												unknown
											>;
											const extendBy = restartData.extend_by as number;
											const oldWindow = restartData.old_window as number;
											const newWindow = restartData.new_window as number;

											log.info(
												`Media context expansion restart signal detected. Expanding window from ${oldWindow} to ${newWindow} messages (extend_by=${extendBy}).`,
											);

											// Rebuild context with expanded media window
											// This uses the same simplifiedMessages array that's already been mushed
											contextSegments = await buildContext({
												guildId: serverDiscId,
												serverName,
												serverDescription: serverDescription ?? null,
												simplifiedMessageHistory: simplifiedMessages,
												userList,
												channelDesc,
												channelName,
												client,
												triggererName,
												emojiStrings,
												// Use the current persona nickname so role mapping and samples match the responding persona
												tomoriNickname: // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
													currentPersona.tomori_nickname ?? tomoriState!.tomori_nickname,
												// biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
												tomoriAttributes: tomoriState!.attribute_list,
												// biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
												tomoriConfig: tomoriState!.config,
												isDMChannel,
												mediaContextWindow: newWindow, // Pass the expanded window
												snapshot: personaSnapshot, // Use persona-specific snapshot for rebuild
												preloadedEmojis: loadedEmojis, // Pass pre-loaded emoji data to avoid redundant DB query
												preloadedStickers: loadedStickers, // Pass pre-loaded sticker data to avoid redundant DB query
											});

											log.success(
												`Rebuilt context with expanded media window (${newWindow} messages). Total context items: ${contextSegments.length}`,
											);

											// Apply emoji repetition penalty after rebuilding context
											contextSegments = applyEmojiPenaltyIfNeeded(
												contextSegments,
												tomoriState?.tomori_nickname ??
													process.env.DEFAULT_BOTNAME ??
													"Tomori",
											);
											// Continue to next iteration WITHOUT adding to function interaction history
											// This will restart the streaming with enhanced context
											continue;
										}
									} else {
										// Tool execution failed
										functionExecutionResult = {
											status: "tool_execution_failed",
											reason:
												toolResult.error ||
												"Tool execution failed without specific error",
											tool_name: funcName,
										};
										log.error(
											`Tool execution failed for ${funcName}: ${toolResult.error}`,
										);
									}

									// 3. Add the model's function call and our function's result to the history
									const historyEntry: {
										functionCall: FunctionCall;
										functionResponse: Record<string, unknown>;
										imageMetadata?: typeof toolResult.imageMetadata;
									} = {
										functionCall: funcCall,
										functionResponse: {
											functionResponse: {
												name: funcName,
												response: { result: functionExecutionResult },
											},
										},
									};

									// Add imageMetadata if present (for tools that send images like brave_image_search)
									if (toolResult.imageMetadata) {
										historyEntry.imageMetadata = toolResult.imageMetadata;
										log.info(
											`Including ${toolResult.imageMetadata.totalSent} image(s) in function response history for LLM visibility`,
										);
									}

									functionInteractionHistory.push(historyEntry);

									// 4. Safety break if max iterations reached
									if (i === MAX_FUNCTION_CALL_ITERATIONS - 1) {
										log.warn(
											"Max function call iterations reached in streaming mode. LLM did not provide a final text stream.",
										);
										// Send a fallback message if no stream occurred.
										// If some text was streamed before this, this might be redundant.
										// For now, assume streamGeminiToDiscord handles its own errors if it starts streaming.
										// If it returns function_call repeatedly, this is the fallback.
										await sendStandardEmbed(channel, locale, {
											color: ColorCode.WARN,
											titleKey: "genai.max_iterations_title", // New locale key
											descriptionKey:
												"genai.max_iterations_streaming_description", // New locale key
											footerKey: "genai.generic_error_footer",
										});
										finalStreamCompleted = true; // Mark as "completed" to exit loop
										selectedStickerToSend = null; // Clear sticker
										break;
									}
									// Continue to the next iteration of the loop to call streamGeminiToDiscord again with updated history
									break;
								}

								default: {
									// Exhaustive check - TypeScript will error if a new status is added but not handled
									const _exhaustive: never = streamResult.status;
									log.error(
										`Unhandled stream status in streaming loop: ${_exhaustive}`,
										new Error(
											`Unknown status: ${JSON.stringify(streamResult)}`,
										),
									);

									// Show user-facing error for unknown status
									await sendStandardEmbed(channel, locale, {
										titleKey: "genai.no_response_title",
										descriptionKey: "genai.no_response_description",
										color: ColorCode.WARN,
										footerKey: "genai.generic_error_footer",
									}).catch((e) =>
										log.warn(
											"Failed to send unhandled status embed to channel",
											e,
										),
									);

									finalStreamCompleted = true; // Break loop on unexpected status
									break;
								}
							} // End of switch statement

							// Check if we should exit the loop after switch statement
							if (finalStreamCompleted) {
								break; // Exit the for loop
							}
						} catch (streamingError) {
							log.error(
								"Critical error during streamGeminiToDiscord call within streaming loop:",
								streamingError,
								{
									serverId: tomoriState?.server_id,
									errorType: "StreamingInvocationError",
									metadata: { channelId: channel.id, iteration: i + 1 },
								},
							);
							await sendStandardEmbed(channel, locale, {
								color: ColorCode.ERROR,
								titleKey: "genai.generic_error_title",
								descriptionKey: "genai.stream.streaming_failed_description",
								descriptionVars: {
									error_message:
										streamingError instanceof Error
											? streamingError.message
											: "Unknown Error",
								},
								footerKey: "genai.generic_error_footer",
							});
							finalStreamCompleted = true; // Break loop on critical error
							break;
						}
					} // End of for loop for function call iterations

					// Clear YouTube processing disable flag after streaming completes
					if (streamingContext.disableYouTubeProcessing) {
						streamingContext.disableYouTubeProcessing = false;
						log.info(
							"Re-enabled YouTube processing function after enhanced context restart completion",
						);
					}

					// Clear profile picture processing disable flag after streaming completes
					if (streamingContext.disableProfilePictureProcessing) {
						streamingContext.disableProfilePictureProcessing = false;
						log.info(
							"Re-enabled profile picture processing function after enhanced context restart completion",
						);
					}

					// 5. After the loop, if a sticker was selected and a stream completed, send the sticker.
					// This is a simple approach; sticker will appear after the streamed text.
					if (selectedStickerToSend && finalStreamCompleted) {
						try {
							// If the last interaction was a reply (isFromQueue), try to reply with sticker too.
							// Otherwise, just send to channel.
							if (isFromQueue) {
								await message.reply({ stickers: [selectedStickerToSend.id] });
							} else {
								await channel.send({ stickers: [selectedStickerToSend.id] });
							}
							log.info(
								`Sent selected sticker '${selectedStickerToSend.name}' after stream.`,
							);
						} catch (stickerError) {
							log.error(
								"Failed to send selected sticker after stream:",
								stickerError,
								{
									serverId: tomoriState?.server_id,
									errorType: "StickerSendError",
									metadata: { stickerId: selectedStickerToSend.id },
								},
							);
						}
					} else if (!finalStreamCompleted) {
						log.warn(
							"Streaming process did not complete successfully, final response might be missing.",
						);
						// Potentially send a message indicating an issue if no error was already sent.
					}

					// Persona response completed
					log.success(
						`Completed response ${personaIndex + 1}/${personasToRespond.length} from persona "${currentPersona.tomori_nickname}"`,
					);
				} catch (personaError) {
					// Handle errors for this specific persona and continue with remaining personas
					log.error(
						`Error generating response for persona "${currentPersona.tomori_nickname}" (${personaIndex + 1}/${personasToRespond.length}). Continuing with remaining personas.`,
						personaError as Error,
						{
							serverId: currentPersona.server_id,
							errorType: "PersonaResponseError",
							metadata: {
								personaId: currentPersona.tomori_id,
								personaNickname: currentPersona.tomori_nickname,
								isAlter: currentPersona.is_alter,
								personaIndex,
								totalPersonas: personasToRespond.length,
							},
						},
					);

					// Always send error embed for failed persona
					await sendStandardEmbed(channel, locale, {
						color: ColorCode.ERROR,
						titleKey: "general.errors.persona_response_failed_title",
						descriptionKey: "general.errors.persona_response_failed_description",
						descriptionVars: {
							personaName: currentPersona.tomori_nickname,
						},
						footerKey: "genai.generic_error_footer",
					}).catch((embedError) =>
						log.warn("Failed to send persona error embed", embedError),
					);
				}
			} // END OF MULTI-PERSONA RESPONSE LOOP
		} catch (error) {
			// 14. Global error handler for entire function
			log.error("Unhandled error in tomoriChat handler:", error);
			// Use default locale as userRow might not be available
			await sendStandardEmbed(channel, "en-US", {
				color: ColorCode.ERROR,
				titleKey: "general.errors.critical_error_title",
				descriptionKey: "general.errors.critical_error_description",
				footerKey: "genai.generic_error_footer",
			});
		}
	} finally {
		// --- Semaphore Logic: Release lock and process queue (only for non-recursive calls) ---
		if (!skipLock && lockEntry) {
			// Ensure lockEntry is defined
			const channelLockId = channel.id;
			lockEntry.isLocked = false;
			lockEntry.lockedAt = 0;
			lockEntry.currentMessageId = undefined;
			lockEntry.userDiscId = undefined; // Clear user tracking for rate limiting
			lockEntry.currentIsPersonaJob = false;
			log.info(
				`Channel ${channelLockId} lock released for message ${message.id}.`,
			);

			// Check for stop context and create response after lock release
			const { StreamOrchestrator } = await import(
				"../../utils/discord/streamOrchestrator"
			);
			const stopContext =
				StreamOrchestrator.getAndClearStopContext(channelLockId);
			if (stopContext) {
				log.info(
					`Found stop context for channel ${channelLockId}. Triggering stop response after lock release.`,
				);

				// Trigger stop response after current execution completes and lock is fully released
				setImmediate(async () => {
					try {
						await handleStopResponse(
							stopContext.originalStopMessage,
							stopContext.client,
						);
					} catch (error) {
						log.error(
							"Failed to generate stop response after lock release:",
							error,
						);
					}
				});
			}

			// Check if there are messages in the queue for this channel
			if (lockEntry.messageQueue.length > 0) {
				const nextMessageData = lockEntry.messageQueue.shift(); // Get the next message (FIFO)
				if (nextMessageData) {
					log.info(
						`Processing next message ${nextMessageData.message.id} from queue for channel ${channelLockId}. Queue size: ${lockEntry.messageQueue.length}`,
					);
					// Call tomoriChat recursively for the next message.
					// This will re-evaluate the lock status (which should now be false).
					// Use a non-blocking call or setImmediate to avoid deep recursion issues if many messages are queued.
					setImmediate(() => {
						tomoriChat(
							client,
							nextMessageData.message,
							true,
							nextMessageData.isManuallyTriggered,
							nextMessageData.forceReason,
							nextMessageData.reasoningQuery,
							nextMessageData.llmOverrideCodename,
							nextMessageData.isStopResponse, // Pass through the stop response flag
							0, // retryCount - start fresh for queued messages
							false, // skipLock - queued messages should acquire lock normally
							undefined, // reminderRecipientID
							undefined, // reminderData
							nextMessageData.selectedPersonaId,
							nextMessageData.isPersonaJob ?? false,
						).catch((e) => {
							log.error(
								`Error processing queued message ${nextMessageData.message.id}:`,
								e,
							);
						});
					});
				}
			} else {
				// If queue is empty, we can consider removing the lock entry to save memory,
				// or keep it for a while if channels are frequently active.
				// For simplicity now, we'll keep it.
				// If we wanted to clean up:
				// if (channelLocks.get(channelLockId)?.messageQueue.length === 0 && !channelLocks.get(channelLockId)?.isLocked) {
				// channelLocks.delete(channelLockId);
				// log.info(`Cleaned up empty lock entry for channel ${channelLockId}`);
				// }
			}
		}
		// --- End Semaphore Logic in finally ---
	}
}

/**
 * Determines which personas should respond to a message based on trigger matching.
 * All matching personas respond, but in randomized order for variety.
 * @param message - The incoming Discord message
 * @param allPersonas - Array of all personas (main + alters)
 * @param client - Discord client for mention checks
 * @param isReplyToBot - Whether message is a reply to the bot
 * @param replyPersona - Persona that the message is replying to (if any)
 * @param isBotMentioned - Whether bot is mentioned in the message
 * @param isAutoMsgHit - Whether auto-message threshold is hit
 * @returns Array of matching personas in randomized order
 */
export function determineMatchingPersonas(
	message: Message,
	allPersonas: TomoriState[],
	_client: Client,
	isReplyToBot: boolean,
	replyPersona: TomoriState | null,
	isBotMentioned: boolean,
	isAutoMsgHit: boolean,
): TomoriState[] {
	// 1. Special cases: Only main persona responds
	// (reply to a persona, reply to bot, bot mentioned, auto-message hit)
	if (replyPersona) {
		return [replyPersona];
	}
	if (isReplyToBot || isBotMentioned || isAutoMsgHit) {
		// Find main persona (is_alter = false)
		const mainPersona = allPersonas.find((p) => !p.is_alter);
		return mainPersona ? [mainPersona] : [];
	}

	// 2. Trigger word matching: Check all personas
	const matchingPersonas: TomoriState[] = [];

	for (const persona of allPersonas) {
		const config = persona.config;
		if (!config) continue;

		// Determine which trigger list to use
		const triggers = persona.is_alter
			? persona.alter_triggers || []
			: config.trigger_words;

		// Check if any trigger matches the message content
		const triggersActive = triggers.some((trigger: string) => {
			// 1. Check if trigger is a mention (starts with <@)
			if (trigger.startsWith("<@")) {
				const userId = trigger.replace(/[<@!>]/g, ""); // Extract user ID
				return message.mentions.users.has(userId);
			}

			// 2. Check if trigger contains Japanese characters
			const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(
				trigger,
			);
			if (isJapanese) {
				return message.content.includes(trigger);
			}

			// 3. Use word boundaries for English triggers (case-insensitive)
			const regex = new RegExp(`\\b${escapeRegExp(trigger)}\\b`, "i");
			return regex.test(message.content);
		});

		if (triggersActive) {
			matchingPersonas.push(persona);
		}
	}

	// 3. Randomize order: All matching personas respond, but in random order
	// Fisher-Yates shuffle for fair randomization
	if (matchingPersonas.length > 1) {
		for (let i = matchingPersonas.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[matchingPersonas[i], matchingPersonas[j]] = [
				matchingPersonas[j],
				matchingPersonas[i],
			];
		}
	}

	return matchingPersonas;
}

/**
 * Determines if the bot should generate a reply based on message context and bot settings.
 * @param message - The incoming Discord message.
 * @param tomoriState - The current state of the bot for the server (TomoriRow + TomoriConfigRow).
 * @returns True if the bot should reply, false otherwise.
 */
export function shouldBotReply(
	message: Message,
	tomoriState: TomoriState,
	allPersonas: TomoriState[],
): boolean {
	// 1. Basic checks: Ignore bots, commands, non-text channels, and messages with no content
	const isThreadChannel =
		message.channel.type === ChannelType.PublicThread ||
		message.channel.type === ChannelType.PrivateThread ||
		message.channel.type === ChannelType.AnnouncementThread;
	const isVoiceChannel =
		message.channel.type === ChannelType.GuildVoice ||
		message.channel.type === ChannelType.GuildStageVoice;
	if (
		message.author.bot ||
		message.content.startsWith("!") || // Basic command prefix check
		!(
			message.channel instanceof TextChannel ||
			message.channel instanceof DMChannel ||
			isThreadChannel ||
			isVoiceChannel
		) // Support TextChannel, DMChannel, thread, and voice/stage channels
	) {
		return false;
	}

	// Config is guaranteed to exist by loadTomoriState structure
	// biome-ignore lint/style/noNonNullAssertion: config is part of TomoriState type
	const config = tomoriState.config!;

	// 2. Check if the message is a reply to the bot
	let isReplyToBot = false;
	let isReplyToPersona = false;
	const personaByNickname = new Map<string, TomoriState>();
	for (const persona of allPersonas) {
		const nicknameKey = persona.tomori_nickname?.toLowerCase();
		if (!nicknameKey || personaByNickname.has(nicknameKey)) continue;
		personaByNickname.set(nicknameKey, persona);
	}
	if (message.reference?.messageId) {
		const referenceMessage = message.channel.messages.cache.get(
			message.reference.messageId,
		);
		// biome-ignore lint/style/noNonNullAssertion: client.user is available in messageCreate event
		if (referenceMessage?.author.id === message.client.user!.id) {
			isReplyToBot = true;
			isReplyToPersona = true;
		} else if (referenceMessage?.webhookId) {
			const webhookName = referenceMessage.author.username;
			const matchedPersona = webhookName
				? personaByNickname.get(webhookName.toLowerCase())
				: undefined;
			if (matchedPersona) {
				isReplyToPersona = true;
			}
		}
	}

	// 3. Check if the bot is mentioned directly
	// biome-ignore lint/style/noNonNullAssertion: client.user is available in messageCreate event
	const isBotMentioned = message.mentions.users.has(message.client.user!.id);

	// 4. Check if the message content triggers ANY persona (main or alters)
	const triggersActive = allPersonas.some((persona) => {
		// Determine which trigger list to use
		const triggers = persona.is_alter
			? persona.alter_triggers || []
			: persona.config?.trigger_words || [];

		return triggers.some((trigger: string) => {
			// Check if trigger is a mention (starts with <@)
			if (trigger.startsWith("<@")) {
				const userId = trigger.replace(/[<@!>]/g, ""); // Extract user ID
				return message.mentions.users.has(userId);
			}
			// Check if trigger contains Japanese characters
			const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(
				trigger,
			);
			if (isJapanese) {
				return message.content.includes(trigger);
			}
			// Use word boundaries for English triggers (case-insensitive)
			const regex = new RegExp(`\\b${escapeRegExp(trigger)}\\b`, "i");
			return regex.test(message.content);
		});
	});

	// 5. Check if the auto-message counter threshold is met
	const autoMsgThreshold = config.autoch_threshold;
	const isAutoChannelActive =
		autoMsgThreshold > 0 && config.autoch_disc_ids.length > 0;
	// Use 'autoch_counter' directly from tomoriState (TomoriRow part)
	const currentCount = tomoriState.autoch_counter;

	// Check if auto-channel is active, threshold is positive, counter has started, AND modulo is 0
	// Also ensure the message is in one of the designated auto-channels
	const isAutoMsgHit =
		isAutoChannelActive &&
		config.autoch_disc_ids.includes(message.channel.id) && // Check if current channel is an auto-channel
		currentCount > 0 && // Ensure counter has started (avoid trigger on first message after reset)
		currentCount % autoMsgThreshold === 0;

	// 6. Determine if bot should reply:
	// Reply if (it's a reply to the bot OR bot is mentioned OR triggers are active) OR if the auto-message threshold is hit
	return isReplyToBot || isReplyToPersona || isBotMentioned || triggersActive || isAutoMsgHit;
}

/**
 * Handles stop response generation after a stream has been interrupted
 * @param originalStopMessage - The original message that requested the stop
 * @param client - Discord client
 */
export async function handleStopResponse(
	originalStopMessage: Message,
	client: Client,
): Promise<void> {
	try {
		log.info(
			`Generating stop response for message ${originalStopMessage.id} in channel ${originalStopMessage.channel.id}`,
		);

		// Use original stop message as "passport" (like respond.ts command does)
		// isManuallyTriggered: true bypasses all normal trigger logic
		await tomoriChat(
			client,
			originalStopMessage,
			true, // isFromQueue to trigger reply to same message
			true, // isManuallyTriggered - this bypasses normal trigger logic and forces response
			false, // forceReason
			undefined, // reasoningQuery
			undefined, // llmOverrideCodename
			true, // isStopResponse - This prevents the stop response from being stopped
			0, // retryCount - start fresh for stop responses
			false, // skipLock - stop responses should acquire lock normally
		);
	} catch (error) {
		log.error("Failed to handle stop response:", error);
	}
}
