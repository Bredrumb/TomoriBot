import type { Client, PresenceStatus } from "discord.js";
import { GatewayIntentBits } from "discord.js";
import { sql } from "../db/client"; // Import SQL client for database queries
import {
	isBlacklisted, // Import blacklist checker
	getPrivacyLevel, // Import privacy level checker
	loadTomoriState,
	loadUserRow,
	getPendingRemindersForUser,
	loadEmbeddingModelById,
} from "../db/dbRead"; // Import session helpers
import {
	ContextItemTag,
	type ContextPart, // New: For text/image parts
	type StructuredContextItem, // New: The main output type
} from "../../types/misc/context";
import { registerUser } from "../db/dbWrite";
import { log } from "../misc/logger";
import {
	replaceTemplateVariables,
	humanizeString,
	normalizeCustomEmojisForLlm,
} from "./stringHelper";
import {
	applyUncensorInputTransforms,
	buildUncensorInjectionText,
} from "./uncensor";
import {
	getCurrentTimeWithOffset,
	formatUTCOffset,
	getTimeOfDayPhrase,
} from "./timezoneHelper";
import {
	HumanizerDegree,
	PrivacyLevel,
	type TomoriConfigRow,
	type ServerEmojiRow,
	type ServerStickerRow,
} from "@/types/db/schema";
import { memoryGuard, MEDIA_LIMITS } from "../security/rateLimiter";
import { decryptApiKey } from "../security/crypto";
import {
	formatRetrievedChunksForPrompt,
	retrieveRelevantDocumentChunks,
} from "../documents/documentService";
import {
	getShortTermMemoriesForUser,
	getShortTermMemoryForChannel,
	getRelativeTimestamp,
} from "../cache/shortTermMemoryCache";
import { getCachedUserRow } from "../cache/userCache";
import { formatMemoryWithId } from "../memory/memoryId";

/**
 * Maps userId -> nickname for the current mention replacement operation.
 * @remarks This cache is cleared after each text processing run to avoid stale data.
 */
const mentionCache = new Map<string, string>();

// Environment variables for short-term memory configuration
const MIN_MESSAGES_FOR_SUMMARY = Number.parseInt(
	process.env.SHORT_TERM_MEMORY_MIN_MESSAGES_FOR_SUMMARY || "6",
	10,
);
const MAX_OTHER_CHANNEL_MEMORIES = Number.parseInt(
	process.env.SHORT_TERM_MEMORY_MAX_OTHER_CHANNELS || "3",
	10,
);

const DOCUMENT_CONTEXT_MAX_CHARS = 2000;
const DOCUMENT_QUERY_MAX_LENGTH = 1000;
const DOCUMENT_QUERY_MIN_LENGTH = 3;
const DOCUMENT_MAX_RESULTS = 6;
const DOCUMENT_MIN_SIMILARITY = 0.2;

export const DEFAULT_SYSTEM_PROMPT =
	"\n{bot} limits themselves to only 0 to 2 emojis per response ({bot} prefers to use available server emojis than normal emojis) and makes sure to respond short and concisely, as {bot} is aware that no one really likes to read walls of text. {bot} only makes lengthy responses if and only if people are asking for assistance or an explanation that warrants it.";

/**
 * Simplified message structure received from tomoriChat.ts.
 * This is an internal representation before converting to StructuredContextItem.
 */
type SimplifiedMessageForContext = {
	id: string; // Discord message ID
	authorId: string;
	authorName: string;
	authorType: "user" | "persona";
	personaName?: string | null;
	content: string | null;
	mediaSourceMessageIds?: string[]; // Array of message IDs that host media (for combined messages)
	imageAttachments: Array<{
		url: string;
		proxyUrl: string;
		mimeType: string | null;
		filename: string;
		isEmoji?: boolean; // True if this attachment is a custom Discord emoji
	}>;
	videoAttachments: Array<{
		url: string;
		proxyUrl: string;
		mimeType: string | null;
		filename: string;
		isYouTubeLink: boolean;
	}>;
};

/**
 * Quick check to determine if text contains patterns that need conversion.
 * Avoids expensive processing for text without Discord mentions or template variables.
 * @param text - Text to check
 * @returns True if text needs conversion, false otherwise
 */
function needsConversion(text: string): boolean {
	// Check for Discord mentions: <@userid>, <#channelid>, <@&roleid>
	// Check for template variables: {bot}, {user}
	return /<[@#][!&]?\d{17,19}>/.test(text) || /\{(?:bot|user)\}/i.test(text);
}

/**
 * Converts Discord mention IDs to human-readable names using cached database lookups.
 * Also handles special placeholders like {user} and {bot}.
 * Checks for custom user nicknames first, falls back to Discord usernames.
 * @param text - Text containing Discord mention strings or placeholders
 * @param client - Discord client for user/role lookups
 * @param serverId - Discord server ID for context
 * @param triggererName - Name of the user who triggered the action (for {user} replacement)
 * @param tomoriNickname - The bot's current nickname for {bot} replacement.
 * @param personalMemoriesEnabled - Whether server personalization is enabled (affects custom nickname usage)
 * @param snapshot - Optional per-request snapshot to avoid redundant DB queries
 * @returns Text with mentions and placeholders replaced by human-readable names
 */
export async function convertMentions(
	text: string,
	client: Client,
	serverId: string,
	triggererName?: string,
	tomoriNickname?: string, // Added tomoriNickname parameter
	personalMemoriesEnabled?: boolean, // Added personalMemoriesEnabled parameter
	snapshot?: import("../../types/misc/context").RequestSnapshot, // Added snapshot parameter
): Promise<string> {
	// Early return: if text doesn't contain mentions or placeholders, skip processing
	if (!needsConversion(text)) {
		return text;
	}

	// Clear the cache before processing new text
	mentionCache.clear();

	// 1. Determine Tomori's nickname for {bot} replacement.
	//    If not passed, load it (using snapshot if available, otherwise DB query).
	let currentTomoriNickname = tomoriNickname;
	if (!currentTomoriNickname) {
		// Use snapshot if available, otherwise load from DB
		const tomoriState =
			snapshot?.tomoriState ?? (await loadTomoriState(serverId));
		currentTomoriNickname =
			tomoriState?.tomori_nickname || process.env.DEFAULT_BOTNAME || "Tomori";
	}

	// 2. First handle Discord mentions
	const mentionPattern = /<[@#][!&]?(\d{17,19})>/g;
	const matches = Array.from(text.matchAll(mentionPattern));
	let result = text;

	// 3. Process Discord mentions
	if (matches.length > 0) {
		const mentionsData = matches.map((match) => ({
			match: match[0],
			id: match[1],
			start: match.index ?? 0,
			end: (match.index ?? 0) + match[0].length,
		}));

		const replacements = await Promise.all(
			mentionsData.map(async ({ match, id }) => {
				// --- User Mentions ---
				if (match.startsWith("<@")) {
					const cachedName = mentionCache.get(id);
					if (cachedName) return `${cachedName}`;
					try {
						// Check if this is Tomori herself
						if (client.user && id === client.user.id && currentTomoriNickname) {
							mentionCache.set(id, currentTomoriNickname);
							return `${currentTomoriNickname}`;
						}

						// Check if this is the triggerer and we have snapshot data
						const isTriggererId =
							snapshot?.triggererUserRow?.user_disc_id === id;
						const isUserBlacklisted = isTriggererId
							? (snapshot?.isTriggererBlacklisted ?? false)
							: await isBlacklisted(serverId, id);
						const userData = isTriggererId
							? snapshot?.triggererUserRow
							: await loadUserRow(id);
						const serverPersonalizationDisabled =
							personalMemoriesEnabled === false;

						// Use Discord username if user is blacklisted OR server personalization is disabled OR no custom nickname exists
						if (
							isUserBlacklisted ||
							serverPersonalizationDisabled ||
							!userData?.user_nickname
						) {
							const user =
								client.users.cache.get(id) ||
								(await client.users.fetch(id).catch(() => null));
							if (user) {
								mentionCache.set(id, user.username);
								return `${user.username}`;
							}
						} else {
							// Use custom nickname only if user is not blacklisted AND personalization is enabled
							mentionCache.set(id, userData.user_nickname);
							return `${userData.user_nickname}`;
						}
					} catch (error) {
						log.error(
							`Error resolving nickname for user ${id} in convertMentions:`,
							error,
							{
								errorType: "MentionResolutionError",
								metadata: { userIdToResolve: id, guildDiscordId: serverId },
							},
						);
					}
					log.warn(`Could not resolve user mention: ${match}`);
					return match; // Return original mention if resolution fails
				}

				// --- Channel Mentions ---
				if (match.startsWith("<#")) {
					try {
						const guild = client.guilds.cache.get(serverId);
						const channel =
							guild?.channels.cache.get(id) ||
							(await client.channels.fetch(id).catch(() => null));
						if (channel?.isTextBased() && !channel.isDMBased()) {
							return `#${channel.name} (ID: ${id})`;
						}
					} catch (error) {
						log.error(
							`Error resolving channel mention ${id} in convertMentions:`,
							error,
							{
								errorType: "MentionResolutionError",
								metadata: { channelIdToResolve: id, guildDiscordId: serverId },
							},
						);
					}
					log.warn(`Could not resolve channel mention: ${match}`);
					return match;
				}

				// --- Role Mentions ---
				if (match.startsWith("<@&")) {
					try {
						const guild = client.guilds.cache.get(serverId);
						const role =
							guild?.roles.cache.get(id) ||
							(await guild?.roles.fetch(id).catch(() => null));
						if (role) {
							return `@${role.name}`;
						}
					} catch (error) {
						log.error(
							`Error resolving role mention ${id} in convertMentions:`,
							error,
							{
								errorType: "MentionResolutionError",
								metadata: { roleIdToResolve: id, guildDiscordId: serverId },
							},
						);
					}
					log.warn(`Could not resolve role mention: ${match}`);
					return match;
				}
				return match; // Should not happen if regex is correct
			}),
		);

		// 4. Apply replacements for Discord mentions (from end to start to avoid index issues)
		for (let i = mentionsData.length - 1; i >= 0; i--) {
			const { start, end } = mentionsData[i];
			// Ensure start and end are valid before attempting substring
			if (
				typeof start === "number" &&
				typeof end === "number" &&
				start < end &&
				start < result.length &&
				end <= result.length
			) {
				result =
					result.substring(0, start) + replacements[i] + result.substring(end);
			} else {
				log.warn(
					`Invalid mention indices for replacement: start=${start}, end=${end}, match=${mentionsData[i].match}`,
				);
			}
		}
	}

	// 5. Apply template variable replacements (like {bot} and {user})
	// Ensure triggererName is defined, default to "User" if not.
	const finalTriggererName = triggererName || "User";
	result = replaceTemplateVariables(result, {
		bot: currentTomoriNickname,
		user: finalTriggererName,
	});

	return result;
}

/**
 * Builds a human-readable description of media content in a message.
 * Handles images, videos, GIFs, and combined content.
 * @param msg - SimplifiedMessageForContext to describe
 * @returns Media description string (e.g., "1 GIF", "2 images and 1 video")
 * @example
 * buildMediaDescription({imageAttachments: [{mimeType: "image/gif"}], videoAttachments: []})
 * // Returns: "1 GIF"
 * @example
 * buildMediaDescription({imageAttachments: [{mimeType: "image/png"}, {mimeType: "image/jpeg"}], videoAttachments: [{...}]})
 * // Returns: "2 images and 1 video"
 */
function buildMediaDescription(msg: SimplifiedMessageForContext): string {
	const imageCount = msg.imageAttachments.length;
	const videoCount = msg.videoAttachments.length;
	const hasGif = msg.imageAttachments.some((att) =>
		att.mimeType?.includes("gif"),
	);

	const mediaParts: string[] = [];

	// Handle images (with special case for GIFs)
	if (imageCount > 0) {
		if (hasGif && imageCount === 1) {
			// Single GIF only
			mediaParts.push("1 GIF");
		} else if (hasGif) {
			// Multiple images including at least one GIF
			mediaParts.push(
				`${imageCount} image${imageCount > 1 ? "s" : ""} (including GIF)`,
			);
		} else {
			// Regular images only
			mediaParts.push(`${imageCount} image${imageCount > 1 ? "s" : ""}`);
		}
	}

	// Handle videos
	if (videoCount > 0) {
		mediaParts.push(`${videoCount} video${videoCount > 1 ? "s" : ""}`);
	}

	return mediaParts.join(" and ");
}

function getLatestUserQuery(
	messages: SimplifiedMessageForContext[],
): string | null {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const msg = messages[i];
		if (msg.authorType !== "user") continue;
		if (!msg.content) continue;
		if (msg.authorId === "0") continue; // Skip synthetic continuation prompts
		const trimmed = msg.content.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("[System:")) continue;
		return trimmed.slice(0, DOCUMENT_QUERY_MAX_LENGTH);
	}

	return null;
}

/**
 * Build short-term memory context for cross-channel and same-channel awareness
 *
 * Phase 2: Loads other-channel crude conversations or summaries (fallback to crude if no summary)
 * Phase 3: Loads same-channel summary with HINT (tool-calling models only)
 *
 * @param triggeringUserId - Discord user ID of the message author
 * @param currentChannelId - Current channel ID
 * @param currentServerId - Current server ID (or "DM")
 * @param tomoriState - Tomori configuration state
 * @param locale - User's preferred locale
 * @param triggererName - Display name of the triggering user
 * @param botName - Bot's display name
 * @param personalMemoriesEnabled - Whether personalization is enabled
 * @param client - Discord client for mention conversion
 * @returns Object with other-channel items and optional same-channel prompt
 */
async function buildShortTermMemoryContext(
	triggeringUserId: string,
	currentChannelId: string,
	currentServerId: string,
	tomoriState: import("@/types/db/schema").TomoriState | null,
	_locale: string,
	triggererName: string,
	botName: string,
	personalMemoriesEnabled: boolean,
	client: Client,
): Promise<{
	memoryItems: StructuredContextItem[];
	createPrompt?: StructuredContextItem;
}> {
	const memoryItems: StructuredContextItem[] = [];
	let createPrompt: StructuredContextItem | undefined;

	try {
		// 1. Check if user has cross-server opt-in enabled
		const userRow = await getCachedUserRow(triggeringUserId);
		const crossServerOptIn =
			userRow?.shortterm_cache_crossserver_opt_in ?? false;

		// 2. Get short-term memories for user (excluding current channel for other-channel section)
		const otherChannelMemories = getShortTermMemoriesForUser(
			triggeringUserId,
			currentChannelId,
		);

		// 3. Filter based on cross-server setting
		const filteredMemories = otherChannelMemories.filter((memory) => {
			// If cross-server disabled, only include memories from same server
			if (!crossServerOptIn && memory.serverId !== currentServerId) {
				return false;
			}
			return true;
		});

		// 4. Limit to max number of other-channel memories (most recent first)
		const limitedMemories = filteredMemories.slice(
			0,
			MAX_OTHER_CHANNEL_MEMORIES,
		);

		// 5. Build OTHER-CHANNEL MEMORIES context (Phase 2)
		// Show summaries when available, fall back to crude conversations
		if (limitedMemories.length > 0) {
			let otherChannelText = "";

			for (const memory of limitedMemories) {
				const relativeTime = getRelativeTimestamp(memory.lastUpdated);

				// Determine channel reference (privacy-safe)
				let channelReference: string;
				if (memory.serverId === currentServerId && memory.channelName) {
					// Same server: use channel mention
					channelReference = `#${memory.channelName}`;
				} else {
					// Different server: generic reference
					channelReference = "a channel in another server";
				}

				// Show summary if available, otherwise show crude conversation
				if (memory.summary) {
					// SUMMARY FORMAT (preferred)
					otherChannelText += `[System: ${botName} remembers a recent conversation with ${triggererName} in ${channelReference} (${relativeTime}):\n${memory.summary}]\n\n`;
				} else {
					// CRUDE CONVERSATION FORMAT (fallback)
					otherChannelText += `[System: ${botName} remembers a recent conversation with ${triggererName} in ${channelReference} (${relativeTime}):\n`;

					for (const msg of memory.messages) {
						const speaker = msg.role === "user" ? triggererName : botName;
						otherChannelText += `${speaker}: "${msg.content}"\n`;
					}

					otherChannelText += "]\n\n";
				}
			}

			if (otherChannelText) {
				memoryItems.push({
					role: "user",
					parts: [
						{
							type: "text",
							text: await convertMentions(
								otherChannelText.trim(),
								client,
								currentServerId,
								triggererName,
								botName,
								personalMemoriesEnabled,
							),
						},
					],
					metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
				});
			}
		}

		// 5. Build SAME-CHANNEL context (Phase 3)
		// Only shown for tool-calling models
		// - Summary (if exists): Goes with other memories (middle of context)
		// - Create prompt (if no summary): Goes at end as instruction
		if (tomoriState?.llm?.has_tools) {
			const sameChannelMemory = getShortTermMemoryForChannel(
				triggeringUserId,
				currentChannelId,
			);

			if (sameChannelMemory?.summary) {
				// EXISTING SUMMARY - Add to memoryItems (middle of context, with other memories)
				const summaryText = `[System: ${botName}'s short term memory for this ongoing conversation:\n${sameChannelMemory.summary}]`;

				memoryItems.push({
					role: "user",
					parts: [
						{
							type: "text",
							text: await convertMentions(
								summaryText,
								client,
								currentServerId,
								triggererName,
								botName,
								personalMemoriesEnabled,
							),
						},
					],
					metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
				});

				// Add the HINT immediately after the summary (not at the end)
				const hintText = `[System: HINT: Use the update_short_term_memory tool to update this information BEFORE you respond if the conversation has greatly changed its topic]`;

				memoryItems.push({
					role: "user",
					parts: [
						{
							type: "text",
							text: await convertMentions(
								hintText,
								client,
								currentServerId,
								triggererName,
								botName,
								personalMemoriesEnabled,
							),
						},
					],
					metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
				});
			} else if (
				sameChannelMemory &&
				sameChannelMemory.messages.length >= MIN_MESSAGES_FOR_SUMMARY
			) {
				// NO SUMMARY but enough messages - Create prompt at end
				const createText = `[System: You currently do not have short term memory saved for this conversation. Use the update_short_term_memory tool to create a short term memory about the current story or conversation's topic BEFORE you respond in order to help you cross-reference this in different channels]`;

				createPrompt = {
					role: "user",
					parts: [
						{
							type: "text",
							text: await convertMentions(
								createText,
								client,
								currentServerId,
								triggererName,
								botName,
								personalMemoriesEnabled,
							),
						},
					],
					metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
				};
			}
			// If less than MIN_MESSAGES_FOR_SUMMARY, don't show any prompt (conversation too short)
		}

		return { memoryItems, createPrompt };
	} catch (error) {
		await log.error(
			`[buildShortTermMemoryContext] Failed to build short-term memory context - triggeringUserId=${triggeringUserId}, currentChannelId=${currentChannelId}`,
			error,
			{
				errorType: "SHORT_TERM_MEMORY_CONTEXT_ERROR",
				metadata: { userDiscId: triggeringUserId, currentChannelId },
			},
		);
		return { memoryItems: [], createPrompt: undefined };
	}
}

export async function buildContext({
	guildId,
	serverName,
	serverDescription,
	simplifiedMessageHistory,
	userList,
	channelDesc: _channelDesc, // Unused after Phase 1 optimization (channel info now in Users in Conversation section)
	channelName,
	channelId, // Added for short-term memory context
	client,
	triggererName,
	emojiStrings: _emojiStrings, // Unused after Phase 1 optimization (emojis fetched directly from guild cache)
	tomoriNickname,
	tomoriAttributes,
	tomoriConfig,
	isDMChannel = false,
	mediaContextWindow,
	snapshot,
	preloadedEmojis,
	preloadedStickers,
	isUserImpersonation = false,
	impersonatedUserId,
	impersonatedUserNickname,
}: {
	guildId: string;
	serverName: string;
	serverDescription: string | null;
	simplifiedMessageHistory: SimplifiedMessageForContext[];
	userList: string[];
	channelDesc: string | null;
	channelName: string;
	channelId: string; // Added for short-term memory context
	client: Client;
	triggererName: string;
	emojiStrings?: string[];
	tomoriNickname: string;
	tomoriAttributes: string[];
	tomoriConfig: TomoriConfigRow;
	isDMChannel?: boolean; // Added for DM support
	mediaContextWindow?: number; // Optional override for media window size
	snapshot?: import("../../types/misc/context").RequestSnapshot; // Optional per-request snapshot
	preloadedEmojis?: ServerEmojiRow[] | null; // Pre-loaded emoji data to avoid redundant DB query
	preloadedStickers?: ServerStickerRow[] | null; // Pre-loaded sticker data to avoid redundant DB query
	isUserImpersonation?: boolean; // Added February 2026 - Flag for user impersonation mode
	impersonatedUserId?: string; // Added February 2026 - User ID being impersonated
	impersonatedUserNickname?: string; // Added February 2026 - Database nickname for impersonated user (optional)
}): Promise<StructuredContextItem[]> {
	const contextItems: StructuredContextItem[] = [];
	const botName = tomoriNickname;
	let missingEmojiMetadataCount = 0;
	let missingStickerMetadataCount = 0;
	const uncensorInputOptions = {
		unicodeSpacesEnabled: tomoriConfig.uncensor_unicode_space_enabled,
		sanitizeEnabled: tomoriConfig.uncensor_sanitize_enabled,
	};

	// 1. System prompt + Humanizer rules (comes FIRST for prompt optimization)
	if (tomoriConfig.humanizer_degree >= HumanizerDegree.LIGHT) {
		const systemPrompt =
			tomoriConfig.system_prompt?.trim() || DEFAULT_SYSTEM_PROMPT;
		let humanizerText = systemPrompt;

		// CRITICAL: Use stable "User" placeholder for system instruction to prevent cache invalidation across different users
		humanizerText = await convertMentions(
			humanizerText,
			client,
			guildId,
			"User", // Stable placeholder instead of triggererName
			botName,
			tomoriConfig.personal_memories_enabled,
			snapshot,
		);

		contextItems.push({
			role: "system",
			parts: [{ type: "text", text: humanizerText }],
			metadataTag: ContextItemTag.SYSTEM_HUMANIZER_RULES,
		});
	}

	// 2. Personality attributes (SECOND - separated from humanizer for better organization)
	let personalityText = tomoriAttributes.join("\n");

	// CRITICAL: Use stable "User" placeholder for system instruction to prevent cache invalidation across different users
	personalityText = await convertMentions(
		personalityText,
		client,
		guildId,
		"User", // Stable placeholder instead of triggererName
		botName,
		tomoriConfig.personal_memories_enabled,
		snapshot,
	);

	contextItems.push({
		role: "system",
		parts: [{ type: "text", text: personalityText }],
		metadataTag: ContextItemTag.SYSTEM_PERSONALITY,
	});

	// --- Preamble/Knowledge Base Segments ---
	// These will be consolidated into the system prompt in Phase 2.
	// For now, they are tagged individually.

	// 3. Server/DM Context
	let serverInfoContent = "";
	if (isDMChannel) {
		// For DMs, indicate the bot is in a direct message (user name will be in dialogue section)
		serverInfoContent = `# Knowledge Base\n${botName} is currently in a Direct Message with User.\n`;
	} else {
		// For servers, show server name and description
		serverInfoContent = `# Knowledge Base\n${botName} is currently in the Discord server named "${serverName}".\n`;
		if (serverDescription) {
			serverInfoContent += `## ${serverName}'s Description\n${serverDescription}`;
		}
	}
	contextItems.push({
		role: "system",
		parts: [
			{
				type: "text",
				text: await convertMentions(
					serverInfoContent,
					client,
					guildId,
					"User", // Stable placeholder instead of triggererName
					botName,
					tomoriConfig.personal_memories_enabled,
					snapshot,
				),
			},
		],
		metadataTag: ContextItemTag.KNOWLEDGE_SERVER_INFO, // Tagging
	});

	// 4. Server Memories / Conversation Memories
	// Use snapshot if available, otherwise load from DB
	const tomoriState = snapshot?.tomoriState ?? (await loadTomoriState(guildId));
	if (
		tomoriState?.server_memories &&
		Array.isArray(tomoriState.server_memories) &&
		tomoriState.server_memories.length > 0
	) {
		// For DMs, label as "Conversation Memories". For servers, label as "Server Memories"
		const memoryLabel = isDMChannel
			? `\n## ${botName}'s Memories about this conversation with User\n`
			: `\n## ${botName}'s Memories about ${serverName}\n`;

		let serverMemoryLines: string[] = [];
		try {
			const serverMemoryRows = await sql<
				Array<{ server_memory_id: number; content: string }>
			>`
				SELECT server_memory_id, content
				FROM server_memories
				WHERE server_id = ${tomoriState.server_id}
				ORDER BY created_at DESC
			`;

			serverMemoryLines = serverMemoryRows.map((row) =>
				formatMemoryWithId(row.server_memory_id, row.content),
			);
		} catch (error) {
			log.warn("Failed to load server memories with IDs for context", error);
			serverMemoryLines = tomoriState.server_memories;
		}

		if (serverMemoryLines.length > 0) {
			const serverMemoriesText = `${memoryLabel}${serverMemoryLines.join("\n")}\n`;
			contextItems.push({
				role: "system",
				parts: [
					{
						type: "text",
						text: await convertMentions(
							serverMemoriesText,
							client,
							guildId,
							"User", // Stable placeholder instead of triggererName
							botName,
							tomoriConfig.personal_memories_enabled,
						),
					},
				],
				metadataTag: ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
			});
		}
	}

	// 4.5 Server Documents (RAG)
	try {
		if (
			memoryGuard.getStatus() !== "critical" &&
			tomoriState &&
			tomoriState.server_id &&
			tomoriState.config.embedding_model_id &&
			tomoriState.config.api_key
		) {
			const queryText = getLatestUserQuery(simplifiedMessageHistory);
			if (queryText && queryText.length >= DOCUMENT_QUERY_MIN_LENGTH) {
				const [documentRow] = await sql`
					SELECT document_id
					FROM documents
					WHERE server_id = ${tomoriState.server_id}
					LIMIT 1
				`;

				if (documentRow?.document_id) {
					const embeddingModel = await loadEmbeddingModelById(
						tomoriState.config.embedding_model_id,
					);
					if (embeddingModel) {
						const decryptedKey = await decryptApiKey(
							tomoriState.config.api_key,
							tomoriState.config.key_version || 1,
						);

						const chunks = await retrieveRelevantDocumentChunks({
							serverId: tomoriState.server_id,
							query: queryText,
							embeddingModel,
							apiKey: decryptedKey,
							maxResults: DOCUMENT_MAX_RESULTS,
							minSimilarity: DOCUMENT_MIN_SIMILARITY,
						});

						const documentContext = formatRetrievedChunksForPrompt(
							chunks,
							DOCUMENT_CONTEXT_MAX_CHARS,
						);

						if (documentContext) {
							contextItems.push({
								role: "system",
								parts: [{ type: "text", text: documentContext }],
								metadataTag: ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
							});
						}
					}
				}
			}
		}
	} catch (error) {
		log.warn("Failed to add server document context", error);
	}

	// 5. Emojis with Semantic Metadata (only available in guild channels, not DMs)
	// CRITICAL: Text-based format with LLM-generated descriptions and emotion keys
	// Kept in system instruction for better caching (deterministic ordering prevents frequent invalidation)
	if (!isDMChannel) {
		const guild = client.guilds.cache.get(guildId);
		const guildEmojisCache = guild?.emojis.cache;

		if (guildEmojisCache && guildEmojisCache.size > 0 && tomoriState) {
			// 1. Use pre-loaded emoji metadata if provided, otherwise load from database
			const emojiMetadata =
				preloadedEmojis && preloadedEmojis.length > 0
					? preloadedEmojis
					: await sql<
							Array<{
								emoji_disc_id: string;
								emoji_name: string;
								emoji_desc: string | null;
								emotion_key: string | null;
								is_animated: boolean;
								created_at: Date | null;
								updated_at: Date | null;
							}>
						>`
				SELECT emoji_disc_id, emoji_name, emoji_desc, emotion_key, is_animated, created_at, updated_at
				FROM server_emojis
				WHERE server_id = ${tomoriState.server_id}
				ORDER BY created_at ASC
			`;

			// 2. Create emoji metadata map by name (case-insensitive), prefer the latest with metadata
			const emojiMetadataByName = new Map<
				string,
				(typeof emojiMetadata)[number]
			>();
			const hasEmojiMetadata = (metadata: (typeof emojiMetadata)[number]) => {
				const hasEmotionKey =
					metadata.emotion_key && metadata.emotion_key !== "unset";
				const hasDescription =
					metadata.emoji_desc && metadata.emoji_desc.trim().length > 0;
				return hasEmotionKey || hasDescription;
			};
			const getMetadataTimestamp = (
				metadata: (typeof emojiMetadata)[number],
			) => {
				const updated = metadata.updated_at?.getTime() ?? 0;
				const created = metadata.created_at?.getTime() ?? 0;
				return Math.max(updated, created);
			};

			for (const metadata of emojiMetadata) {
				if (!metadata.emoji_name) continue;
				const nameKey = metadata.emoji_name.toLowerCase();
				const existing = emojiMetadataByName.get(nameKey);
				if (!existing) {
					emojiMetadataByName.set(nameKey, metadata);
					continue;
				}

				const existingHasMeta = hasEmojiMetadata(existing);
				const currentHasMeta = hasEmojiMetadata(metadata);
				if (currentHasMeta && !existingHasMeta) {
					emojiMetadataByName.set(nameKey, metadata);
					continue;
				}
				if (currentHasMeta === existingHasMeta) {
					const existingTime = getMetadataTimestamp(existing);
					const currentTime = getMetadataTimestamp(metadata);
					if (currentTime >= existingTime) {
						emojiMetadataByName.set(nameKey, metadata);
					}
				}
			}

			// 3. Sort emojis by creation date (deterministic, oldest first for caching stability)
			const sortedEmojis = Array.from(guildEmojisCache.values()).sort(
				(a, b) => {
					const aTime = a.createdTimestamp || 0;
					const bTime = b.createdTimestamp || 0;
					return aTime - bTime; // Ascending order (oldest first)
				},
			);

			// 4. Deduplicate by name (case-insensitive) while keeping latest
			const latestEmojiByName = new Map<
				string,
				(typeof sortedEmojis)[number]
			>();
			for (const emoji of sortedEmojis) {
				if (!emoji.name) continue;
				latestEmojiByName.set(emoji.name.toLowerCase(), emoji);
			}

			const dedupedEmojis = sortedEmojis.filter((emoji) => {
				if (!emoji.name) return false;
				return latestEmojiByName.get(emoji.name.toLowerCase())?.id === emoji.id;
			});

			// 5. Count emojis missing both emotion key and description (based on display list)
			missingEmojiMetadataCount = 0;
			for (const emoji of dedupedEmojis) {
				if (!emoji.name) continue;
				const metadata = emojiMetadataByName.get(emoji.name.toLowerCase());
				const hasEmotionKey =
					metadata?.emotion_key && metadata.emotion_key !== "unset";
				const hasDescription =
					metadata?.emoji_desc && metadata.emoji_desc.trim().length > 0;
				if (!hasEmotionKey && !hasDescription) {
					missingEmojiMetadataCount++;
				}
			}

			// 6. Build emoji list with descriptions and emotion keys
			const emojiLines: string[] = [];
			for (const emoji of dedupedEmojis) {
				const metadata = emojiMetadataByName.get(emoji.name.toLowerCase());
				if (!emoji.name) continue;
				const emojiCode = `:${emoji.name}:`;
				const emotionKey =
					metadata?.emotion_key === "unset"
						? null
						: (metadata?.emotion_key ?? null);

				// Graceful degradation: if no metadata, just show code
				if (!metadata || (!metadata.emoji_desc && !emotionKey)) {
					emojiLines.push(emojiCode);
				} else {
					// Show emotion key and description in a natural phrase if available
					const labelParts: string[] = [];
					if (emotionKey) {
						labelParts.push(`Expresses ${emotionKey}`);
					}
					if (metadata.emoji_desc) {
						labelParts.push(metadata.emoji_desc);
					}
					const label = ` (${labelParts.join("; ")})`;
					emojiLines.push(`${emojiCode}${label}`);
				}
			}

			const emojiContent = `## ${serverName}'s Emojis\n- ${emojiLines.join("\n- ")}.`;
			const emojiUsage = `\nTo use ${serverName}'s emojis, just write :name: (name only, no IDs). Names are case-insensitive, and {bot} will expand them to the correct custom emoji. {bot} only uses server emojis when it matches their actual mood.\n`;

			contextItems.push({
				role: "system",
				parts: [
					{
						type: "text",
						text: await convertMentions(
							emojiContent + emojiUsage,
							client,
							guildId,
							"User", // Stable placeholder
							botName,
							tomoriConfig.personal_memories_enabled,
							snapshot,
						),
					},
				],
				metadataTag: ContextItemTag.KNOWLEDGE_SERVER_EMOJIS,
			});

			log.info(
				`Loaded ${sortedEmojis.length} emoji descriptions for server ${serverName}`,
			);
		}
	}

	// 6. Stickers with Semantic Metadata (only available in guild channels, not DMs)
	// CRITICAL: Text-based format with LLM-generated descriptions and emotion keys for efficient caching
	if (tomoriConfig.sticker_usage_enabled && !isDMChannel) {
		const guild = client.guilds.cache.get(guildId);
		const guildStickersCache = guild?.stickers.cache;

		if (guildStickersCache && guildStickersCache.size > 0 && tomoriState) {
			// 1. Use pre-loaded sticker metadata if provided, otherwise load from database
			const stickerMetadata =
				preloadedStickers && preloadedStickers.length > 0
					? preloadedStickers
					: await sql<
							Array<{
								sticker_disc_id: string;
								sticker_name: string;
								sticker_desc: string | null;
								emotion_key: string | null;
								created_at: Date | null;
								updated_at: Date | null;
							}>
						>`
				SELECT sticker_disc_id, sticker_name, sticker_desc, emotion_key, created_at, updated_at
				FROM server_stickers
				WHERE server_id = ${tomoriState.server_id}
				ORDER BY created_at ASC
			`;

			// 2. Create sticker metadata map by name (case-insensitive), prefer the latest with metadata
			const stickerMetadataByName = new Map<
				string,
				(typeof stickerMetadata)[number]
			>();
			const hasStickerMetadata = (
				metadata: (typeof stickerMetadata)[number],
			) => {
				const hasEmotionKey =
					metadata.emotion_key && metadata.emotion_key !== "unset";
				const hasDescription =
					metadata.sticker_desc && metadata.sticker_desc.trim().length > 0;
				return hasEmotionKey || hasDescription;
			};
			const getStickerMetadataTimestamp = (
				metadata: (typeof stickerMetadata)[number],
			) => {
				const updated = metadata.updated_at?.getTime() ?? 0;
				const created = metadata.created_at?.getTime() ?? 0;
				return Math.max(updated, created);
			};

			for (const metadata of stickerMetadata) {
				if (!metadata.sticker_name) continue;
				const nameKey = metadata.sticker_name.toLowerCase();
				const existing = stickerMetadataByName.get(nameKey);
				if (!existing) {
					stickerMetadataByName.set(nameKey, metadata);
					continue;
				}

				const existingHasMeta = hasStickerMetadata(existing);
				const currentHasMeta = hasStickerMetadata(metadata);
				if (currentHasMeta && !existingHasMeta) {
					stickerMetadataByName.set(nameKey, metadata);
					continue;
				}
				if (currentHasMeta === existingHasMeta) {
					const existingTime = getStickerMetadataTimestamp(existing);
					const currentTime = getStickerMetadataTimestamp(metadata);
					if (currentTime >= existingTime) {
						stickerMetadataByName.set(nameKey, metadata);
					}
				}
			}

			// 3. Sort stickers by creation date (deterministic, oldest first for caching stability)
			const sortedStickers = Array.from(guildStickersCache.values()).sort(
				(a, b) => {
					const aTime = a.createdTimestamp || 0;
					const bTime = b.createdTimestamp || 0;
					return aTime - bTime; // Ascending order (oldest first)
				},
			);

			// 4. Deduplicate by name (case-insensitive) while keeping latest
			const latestStickerByName = new Map<
				string,
				(typeof sortedStickers)[number]
			>();
			for (const sticker of sortedStickers) {
				if (!sticker.name) continue;
				latestStickerByName.set(sticker.name.toLowerCase(), sticker);
			}

			const dedupedStickers = sortedStickers.filter((sticker) => {
				if (!sticker.name) return false;
				return (
					latestStickerByName.get(sticker.name.toLowerCase())?.id === sticker.id
				);
			});

			// 5. Count stickers missing both emotion key and description (based on display list)
			missingStickerMetadataCount = 0;
			for (const sticker of dedupedStickers) {
				if (!sticker.name) continue;
				const metadata = stickerMetadataByName.get(sticker.name.toLowerCase());
				const hasEmotionKey =
					metadata?.emotion_key && metadata.emotion_key !== "unset";
				const hasDescription =
					metadata?.sticker_desc && metadata.sticker_desc.trim().length > 0;
				if (!hasEmotionKey && !hasDescription) {
					missingStickerMetadataCount++;
				}
			}

			// 6. Build sticker list with descriptions and emotion keys
			let stickerContent = `## ${serverName}'s Stickers\nThis server has the following stickers available for ${botName} to use with the 'select_sticker_for_response' function:\n`;

			for (const sticker of dedupedStickers) {
				if (!sticker.name) continue;
				const metadata = stickerMetadataByName.get(sticker.name.toLowerCase());
				const emotionKey =
					metadata?.emotion_key === "unset"
						? null
						: (metadata?.emotion_key ?? null);

				// Build sticker entry
				let stickerEntry = `- "${sticker.name}"`;

				// Add metadata label (LLM first, Discord description as fallback)
				const labelParts: string[] = [];
				if (emotionKey) {
					labelParts.push(`Expresses ${emotionKey}`);
				}
				if (metadata?.sticker_desc) {
					labelParts.push(metadata.sticker_desc);
				}
				if (labelParts.length === 0 && sticker.description) {
					labelParts.push(sticker.description);
				}
				if (labelParts.length > 0) {
					stickerEntry += ` (${labelParts.join("; ")})`;
				}

				stickerEntry += "\n";
				stickerContent += stickerEntry;
			}

			stickerContent +=
				"To use a sticker, call 'select_sticker_for_response' with the sticker's name (case-insensitive).\n";

			// 5. Add as "system" role (stays in system instruction for caching)
			contextItems.push({
				role: "system",
				parts: [
					{
						type: "text",
						text: await convertMentions(
							stickerContent,
							client,
							guildId,
							"User", // Stable placeholder
							botName,
							tomoriConfig.personal_memories_enabled,
						),
					},
				],
				metadataTag: ContextItemTag.KNOWLEDGE_SERVER_STICKERS,
			});

			log.info(
				`Loaded ${sortedStickers.length} sticker descriptions for server ${serverName}`,
			);
		}
	}

	// 6.5. Metadata reminder (server only)
	if (
		!isDMChannel &&
		(missingEmojiMetadataCount > 0 || missingStickerMetadataCount > 0)
	) {
		const reminderText = `Metadata check: ${missingEmojiMetadataCount} emoji(s) and ${missingStickerMetadataCount} sticker(s) have missing emotion key and description. Remind the User to use \`/server initialize expressions\` to fill it up.`;
		contextItems.push({
			role: "system",
			parts: [{ type: "text", text: reminderText }],
			metadataTag: ContextItemTag.KNOWLEDGE_SERVER_INFO,
		});
	}

	// 7. Users in Conversation (ALL user-specific dynamic data)
	// This section combines: time/date, channel, user status, memories, and reminders
	if (userList.length > 0) {
		let usersInConversationText =
			"[System: The following users are having a conversation:\n\n";

		usersInConversationText += `If ${botName} wants to ping any of these users, simply prepend an "@" symbol to their mention handle, like @{username} (case-insensitive). If a name is duplicated, use the handle with the user ID suffix (e.g., @{name|123456789012345678}). This ensures the user gets a notification from ${botName}'s message. Use only if it's an important message, otherwise do not ping users.\n\n`;

		type UserConversationEntry = {
			userId: string;
			displayName: string;
			detailLines: string[];
			isBot: boolean;
			mentionAliases: string[];
			primaryAlias: string | null;
		};

		const userEntries: UserConversationEntry[] = [];
		const aliasCounts = new Map<string, number>();

		const addAlias = (aliases: Set<string>, value?: string | null) => {
			const alias = value?.trim();
			if (!alias) return;
			if (aliases.has(alias)) return;
			aliases.add(alias);
			const key = alias.toLowerCase();
			aliasCounts.set(key, (aliasCounts.get(key) ?? 0) + 1);
		};

		// 3. Process each user (including bot itself)
		for (const userIdToProcess of userList) {
			// 4. Special handling for TomoriBot itself
			if (client.user && userIdToProcess === client.user.id) {
				userEntries.push({
					userId: userIdToProcess,
					displayName: botName,
					detailLines: [
						"- Status: Online - Currently active and responding to messages",
					],
					isBot: true,
					mentionAliases: [],
					primaryAlias: null,
				});
				continue;
			}

			// 5. Load/register user
			let userRow = await loadUserRow(userIdToProcess).catch(() => null);
			if (!userRow) {
				// Try to register if not found (same logic as current implementation)
				const guild = client.guilds.cache.get(guildId);
				const member = guild
					? await guild.members.fetch(userIdToProcess).catch(() => null)
					: null;
				if (guild && member) {
					const serverLocale = guild.preferredLocale;
					const userLanguage = serverLocale.startsWith("ja") ? "ja" : "en-US";
					userRow = await registerUser(
						userIdToProcess,
						member.user.username,
						userLanguage,
					);
				}
			}

			if (!userRow) {
				log.warn(`Skipping user ${userIdToProcess} - could not load user data`);
				continue;
			}

			// 6. Determine display name (respecting personalization settings)
			const guild = client.guilds.cache.get(guildId);
			const member = guild
				? await guild.members.fetch(userIdToProcess).catch(() => null)
				: null;
			const fallbackUser = member
				? null
				: await client.users.fetch(userIdToProcess).catch(() => null);
			const serverPersonalizationEnabled =
				tomoriConfig.personal_memories_enabled ?? true;
			const isTriggererId =
				snapshot?.triggererUserRow?.user_disc_id === userRow.user_disc_id;
			const userIsBlacklisted = isTriggererId
				? (snapshot?.isTriggererBlacklisted ?? false)
				: await isBlacklisted(guildId, userRow.user_disc_id);
			const userPrivacyLevel = isTriggererId
				? (snapshot?.triggererPrivacyLevel ?? PrivacyLevel.MINIMAL)
				: await getPrivacyLevel(userRow.user_disc_id);

			let displayName: string;
			const customNickname = userRow.user_nickname;
			const serverNickname = member?.nickname;
			const username = member?.user.username ?? fallbackUser?.username ?? null;
			const globalName =
				member?.user.globalName ?? fallbackUser?.globalName ?? null;
			const canUseCustomNickname =
				customNickname &&
				serverPersonalizationEnabled &&
				!userIsBlacklisted &&
				userPrivacyLevel !== PrivacyLevel.FULL; // Allow MINIMAL and PARTIAL
			const shouldIncludeCustomNicknameAlias =
				customNickname &&
				serverPersonalizationEnabled &&
				!userIsBlacklisted &&
				(!serverNickname || canUseCustomNickname);

			if (canUseCustomNickname) {
				displayName = serverNickname
					? `${customNickname} (Server Nickname: "${serverNickname}")`
					: customNickname;
			} else if (serverNickname) {
				displayName = serverNickname;
			} else {
				displayName = `<@${userRow.user_disc_id}>`;
			}

			const detailLines: string[] = [];

			// 8. Add status (only for Level 0 MINIMAL privacy)
			// Only include if GuildPresences intent is available (non-production)
			if (userPrivacyLevel === PrivacyLevel.MINIMAL) {
				const hasPresenceIntent = client.options.intents?.has(
					GatewayIntentBits.GuildPresences,
				);

				if (isDMChannel) {
					// DMs always show online
					detailLines.push("- Status: Online (Direct Message)");
				} else if (hasPresenceIntent) {
					// Only fetch presence data if intent is available
					const presenceInfo = isTriggererId
						? await getUserPresenceDetails(
								client,
								userRow.user_disc_id,
								guildId,
								snapshot?.preloadedMember,
							)
						: await getUserPresenceDetails(
								client,
								userRow.user_disc_id,
								guildId,
							);

					detailLines.push(`- Status: ${presenceInfo}`);
				}
				// In production without presence intent: skip status entirely
			}

			// 8.1. Add server roles (only for Level 0 MINIMAL privacy)
			if (userPrivacyLevel === PrivacyLevel.MINIMAL && member) {
				const roles = member.roles.cache
					.filter((role) => role.id !== guild?.id && role.name !== "@everyone")
					.sort((a, b) => b.position - a.position)
					.map((role) => role.name);

				if (roles.length > 0) {
					detailLines.push(`- Server Roles: ${roles.join(", ")}`);
				}
			}

			// 9. Add personal memories (only for Level 0 MINIMAL privacy)
			if (
				serverPersonalizationEnabled &&
				!userIsBlacklisted &&
				userPrivacyLevel === PrivacyLevel.MINIMAL
			) {
				if (userRow.personal_memories && userRow.personal_memories.length > 0) {
					const processedMemories = await Promise.all(
						userRow.personal_memories.map(async (memory, index) => {
							const processedMemory = await convertMentions(
								memory,
								client,
								guildId,
								displayName, // Use memory owner's name for {user} token
								botName,
								tomoriConfig.personal_memories_enabled,
							);
							const memoryId = index + 1;
							return formatMemoryWithId(memoryId, processedMemory);
						}),
					);
					detailLines.push(`- Memories: ${processedMemories.join("; ")}`);
				}
			}

			// 10. Add pending reminders
			const pendingReminders = await getPendingRemindersForUser(
				userRow.user_disc_id,
				guildId,
			);
			if (pendingReminders && pendingReminders.length > 0) {
				detailLines.push("- Reminders:");
				for (const reminder of pendingReminders) {
					const reminderDate = new Date(reminder.reminder_time);
					const formattedTime = reminderDate.toLocaleString("en-US", {
						weekday: "short",
						year: "numeric",
						month: "short",
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
						timeZoneName: "short",
					});
					detailLines.push(
						`  • "${reminder.reminder_purpose}" (scheduled for ${formattedTime})`,
					);
				}
			}

			const aliasSet = new Set<string>();
			if (shouldIncludeCustomNicknameAlias) addAlias(aliasSet, customNickname);
			if (serverNickname) addAlias(aliasSet, serverNickname);
			if (globalName) addAlias(aliasSet, globalName);
			if (username) addAlias(aliasSet, username);

			let primaryAlias: string | null = null;
			if (canUseCustomNickname) primaryAlias = customNickname;
			else if (serverNickname) primaryAlias = serverNickname;
			else if (globalName) primaryAlias = globalName;
			else if (username) primaryAlias = username;

			if (!primaryAlias && aliasSet.size === 0) {
				primaryAlias = userRow.user_disc_id;
				addAlias(aliasSet, primaryAlias);
			}

			userEntries.push({
				userId: userRow.user_disc_id,
				displayName,
				detailLines,
				isBot: false,
				mentionAliases: Array.from(aliasSet),
				primaryAlias,
			});
		}

		const formatMentionHandle = (alias: string, userId: string) => {
			const key = alias.toLowerCase();
			return (aliasCounts.get(key) ?? 0) > 1 ? `${alias}|${userId}` : alias;
		};

		for (const entry of userEntries) {
			if (entry.isBot) {
				usersInConversationText += `${entry.displayName} (User ID: ${entry.userId}) (This is you!)\n`;
			} else {
				const mentionParts: string[] = [];
				if (entry.primaryAlias) {
					const handle = formatMentionHandle(entry.primaryAlias, entry.userId);
					mentionParts.push(`Mention: @{${handle}}`);
				}

				const aliasHandles = entry.mentionAliases
					.filter((alias) => alias !== entry.primaryAlias)
					.map((alias) => `@{${formatMentionHandle(alias, entry.userId)}}`);
				if (aliasHandles.length > 0) {
					mentionParts.push(`Aliases: ${aliasHandles.join(", ")}`);
				}

				const mentionInfo =
					mentionParts.length > 0 ? ` (${mentionParts.join("; ")})` : "";
				usersInConversationText += `${entry.displayName} (User ID: ${entry.userId})${mentionInfo}\n`;
			}

			for (const line of entry.detailLines) {
				usersInConversationText += `${line}\n`;
			}

			usersInConversationText += "\n"; // Blank line between users
		}

		// Append channel/time context last to keep more stable prompt content up front.
		const timezoneOffset = tomoriConfig.timezone_offset ?? 0;
		const currentTime = getCurrentTimeWithOffset(timezoneOffset);
		const timezoneLabel = formatUTCOffset(timezoneOffset);
		const timeOfDayPhrase = getTimeOfDayPhrase(timezoneOffset);
		const conversationContext = isDMChannel
			? "Conversation context: Direct Message."
			: `Conversation context: #${channelName}.`;
		const timeContext = `Current time: ${currentTime} (${timezoneLabel}), ${timeOfDayPhrase}.`;

		usersInConversationText += `${conversationContext}\n${timeContext}\n]`; // Close [System: ...] block

		// 11. Add as "user" role (goes in dialogue contents)
		contextItems.push({
			role: "user",
			parts: [
				{
					type: "text",
					text: await convertMentions(
						usersInConversationText.trim(),
						client,
						guildId,
						triggererName,
						botName,
						tomoriConfig.personal_memories_enabled,
					),
				},
			],
			metadataTag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
		});
	}

	// === SHORT-TERM MEMORY CONTEXT (Phase 2 & 3) ===
	// Load recent conversations from other channels (other-channel awareness)
	// and current channel summary (same-channel working memory)
	// Store same-channel prompt separately to be added at the very end
	let sameChannelMemoryPrompt: StructuredContextItem | undefined;
	try {
		// Determine the triggering user ID (impersonation takes precedence)
		const actualTriggeringUserId =
			impersonatedUserId ?? snapshot?.triggererUserRow?.user_disc_id;

		// Determine locale (from snapshot if available)
		const actualLocale = snapshot?.triggererUserRow?.language_pref ?? "en-US";

		// Only build short-term memory context if we have a valid user ID
		if (actualTriggeringUserId) {
			const { memoryItems, createPrompt } = await buildShortTermMemoryContext(
				actualTriggeringUserId,
				channelId,
				guildId,
				tomoriState,
				actualLocale,
				triggererName,
				botName,
				tomoriConfig.personal_memories_enabled,
				client,
			);
			// Push memory items now (goes in middle of context)
			// Includes: other-channel memories + same-channel summary (if exists)
			contextItems.push(...memoryItems);
			// Store create prompt for later (goes at very end)
			// This is the HINT or "create summary" instruction
			sameChannelMemoryPrompt = createPrompt;
		}
	} catch (error) {
		// Don't fail context building if short-term memory loading fails
		log.warn("Failed to build short-term memory context", error);
	}

	// Skip sample dialogues for user impersonation (users don't need examples of bot's speech)
	if (
		!isUserImpersonation &&
		tomoriState &&
		tomoriState.sample_dialogues_in.length > 0 &&
		tomoriState.sample_dialogues_out.length > 0 &&
		tomoriState.sample_dialogues_in.length ===
			tomoriState.sample_dialogues_out.length
	) {
		// 8. Sample Dialogues (Request 3: Changed to alternating user/model turns)
		// 8.0. Add introductory system message for sample dialogues
		/*
		contextItems.push({
			role: "user",
			parts: [
				{
					type: "text",
					text: `[System: The following are example dialogues on how ${botName} should speak]`,
				},
			],
			metadataTag: ContextItemTag.DIALOGUE_SAMPLE,
		});*/

		// biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
		for (let i = 0; i < tomoriState!.sample_dialogues_in.length; i++) {
			// 8.a. User's part of the sample dialogue
			// biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
			let userSampleText = tomoriState!.sample_dialogues_in[i];
			// No username prefix - prevents associating examples with the triggerer
			if (tomoriConfig.humanizer_degree >= HumanizerDegree.HEAVY) {
				userSampleText = humanizeString(userSampleText);
			}
			contextItems.push({
				role: "user",
				parts: [
					{
						type: "text",
						text: applyUncensorInputTransforms(
							await convertMentions(
								userSampleText,
								client,
								guildId,
								triggererName, // triggererName for {user} if it appears in sample
								botName,
								tomoriConfig.personal_memories_enabled,
							),
							uncensorInputOptions,
						),
					},
				],
				metadataTag: ContextItemTag.DIALOGUE_SAMPLE, // Tagging
			});

			// 8.b. Bot's part of the sample dialogue
			// biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
			let modelSampleText = tomoriState!.sample_dialogues_out[i];
			modelSampleText = `${botName}: ${modelSampleText}`; // Prepend bot's name
			if (tomoriConfig.humanizer_degree >= HumanizerDegree.HEAVY) {
				modelSampleText = humanizeString(modelSampleText);
			}
			contextItems.push({
				role: "model",
				parts: [
					{
						type: "text",
						text: applyUncensorInputTransforms(
							await convertMentions(
								modelSampleText,
								client,
								guildId,
								triggererName,
								botName, // botName for {bot} if it appears in sample
								tomoriConfig.personal_memories_enabled,
							),
							uncensorInputOptions,
						),
					},
				],
				metadataTag: ContextItemTag.DIALOGUE_SAMPLE, // Tagging
			});
		}

		// 8.c. Add closing system message for sample dialogues
		/*
		contextItems.push({
			role: "user",
			parts: [
				{
					type: "text",
					text: `[System: That ends the example dialogues, the following is an actual ongoing conversation ${botName} is currently participating in]`,
				},
			],
			metadataTag: ContextItemTag.DIALOGUE_SAMPLE,
		});*/
	}

	// 9. Conversation History (Main Dialogue)
	// Calculate media windowing boundaries
	const totalMessages = simplifiedMessageHistory.length;
	const effectiveMediaWindow =
		mediaContextWindow ?? memoryGuard.getMediaWindow();
	const maxExtendBy = MEDIA_LIMITS.MESSAGE_FETCH_LIMIT - effectiveMediaWindow;
	const mediaWindowCutoff = totalMessages - effectiveMediaWindow;

	const botNameLower = botName.toLowerCase();
	for (const [index, msg] of simplifiedMessageHistory.entries()) {
		const isPersonaMessage = msg.authorType === "persona" && !!msg.personaName;
		const isCurrentPersonaMessage =
			isPersonaMessage && msg.personaName?.toLowerCase() === botNameLower;

		// Role reversal for user impersonation (February 2026)
		let role: "user" | "model";
		if (isUserImpersonation) {
			// Reverse roles: user messages become "model", bot messages become "user"
			if (msg.authorType === "user" && msg.authorId === impersonatedUserId) {
				role = "model"; // This user's messages are treated as model output
			} else if (isCurrentPersonaMessage) {
				role = "user"; // Bot messages are treated as user input
			} else {
				role = "user"; // Other messages stay as user
			}
		} else {
			// Normal role assignment
			role = isCurrentPersonaMessage ? "model" : "user";
		}

		const parts: ContextPart[] = [];

		// Determine if this message is within the media context window
		const isWithinMediaWindow = index >= mediaWindowCutoff;

		// Check if message has any media (for message ID exposure to tools)
		const hasAnyMedia =
			msg.imageAttachments.length > 0 || msg.videoAttachments.length > 0;

		// Check if message has significant media (non-emoji images or videos)
		// Emoji-only messages are excluded from "increase_media_context" flagging
		// because emojis are common and the system flag message can flood context unnecessarily
		const hasNonEmojiImages = msg.imageAttachments.some((att) => !att.isEmoji);
		const hasVideos = msg.videoAttachments.length > 0;
		const hasSignificantMedia = hasNonEmojiImages || hasVideos;
		let mediaIdHintAdded = false;

		// If message has significant media but is outside window, add placeholder
		// Messages with only emojis are not flagged, but messages with emojis + real media ARE flagged
		if (hasSignificantMedia && !isWithinMediaWindow) {
			// Calculate extend_by needed to reach this message, capped at maxExtendBy
			const extendByNeeded = Math.min(mediaWindowCutoff - index, maxExtendBy);

			// Build media description
			const mediaDescription = buildMediaDescription(msg);

			// Add placeholder text
			parts.push({
				type: "text",
				text: `[System: This message (ID: ${msg.id}) contained ${mediaDescription} - use increase_media_context with extend_by=${extendByNeeded} to view]`,
			});
			mediaIdHintAdded = true;
		} else if (isWithinMediaWindow) {
			// Within window: Add full media if model supports it, otherwise add placeholder
			// Check model capability flags
			const seesImages = tomoriState?.llm.sees_images ?? false;
			const seesVideos = tomoriState?.llm.sees_videos ?? false;

			// 9.a. Add image parts if attachments exist
			if (msg.imageAttachments.length > 0) {
				if (seesImages) {
					// Model supports images - add them normally
					for (const attachment of msg.imageAttachments) {
						if (attachment.mimeType) {
							parts.push({
								type: "image",
								uri: attachment.proxyUrl,
								mimeType: attachment.mimeType,
							});
						} else {
							log.warn(
								`Skipping image attachment due to missing mimeType: ${attachment.filename} from user ${msg.authorName}`,
							);
						}
					}
				} else {
					// Model doesn't support images - add placeholder text
					const imageCount = msg.imageAttachments.length;
					const hasGif = msg.imageAttachments.some((att) =>
						att.mimeType?.includes("gif"),
					);
					let imageDescription: string;

					if (hasGif && imageCount === 1) {
						imageDescription = "a GIF";
					} else if (hasGif) {
						imageDescription = `${imageCount} images (including GIF)`;
					} else {
						imageDescription = `${imageCount === 1 ? "an image" : `${imageCount} images`}`;
					}

					parts.push({
						type: "text",
						text: `[System: This message contains ${imageDescription}. Current model does not support images.]`,
					});
					log.info(
						`Images skipped for message ${msg.id} - model does not support images`,
					);
				}
			}

			// 9.b. Add video parts if attachments exist
			if (msg.videoAttachments.length > 0) {
				if (seesVideos) {
					// Model supports videos - add them normally
					for (const attachment of msg.videoAttachments) {
						if (attachment.mimeType) {
							parts.push({
								type: "video",
								uri: attachment.isYouTubeLink
									? attachment.url
									: attachment.proxyUrl,
								mimeType: attachment.mimeType,
								isYouTubeLink: attachment.isYouTubeLink,
							});
						} else {
							log.warn(
								`Skipping video attachment due to missing mimeType: ${attachment.filename} from user ${msg.authorName}`,
							);
						}
					}
				} else {
					// Model doesn't support videos - add placeholder text
					const videoCount = msg.videoAttachments.length;
					const videoDescription =
						videoCount === 1 ? "a video" : `${videoCount} videos`;

					parts.push({
						type: "text",
						text: `[System: This message contains ${videoDescription}. Current model does not support videos.]`,
					});
					log.info(
						`Videos skipped for message ${msg.id} - model does not support videos`,
					);
				}
			}
		}

		// 9.c. Add text part if content exists (always included, regardless of window)
		if (msg.content) {
			// Request 4: Prepend speaker name to content
			const normalizedContent = normalizeCustomEmojisForLlm(msg.content);

			// Skip author name prefix if content already starts with [System: (e.g., system injection embeds)
			let processedContent: string;
			if (normalizedContent.startsWith("[System:")) {
				processedContent = normalizedContent; // Use as-is, no author prefix
			} else {
				processedContent = `${msg.authorName}: ${normalizedContent}`; // Add author prefix
			}

			if (
				tomoriConfig.humanizer_degree >= HumanizerDegree.HEAVY &&
				role === "model"
			) {
				processedContent = humanizeString(processedContent);
			}
			// convertMentions will handle {user} and {bot} replacements.
			// The {user} in convertMentions will refer to msg.authorName if it's a user message.
			processedContent = await convertMentions(
				processedContent,
				client,
				guildId,
				msg.authorName, // Pass the actual author of this historical message
				botName,
				tomoriConfig.personal_memories_enabled,
			);
			if (!processedContent.startsWith("[System:")) {
				processedContent = applyUncensorInputTransforms(
					processedContent,
					uncensorInputOptions,
				);
			}
			parts.push({ type: "text", text: processedContent });
		}

		// Expose message ID(s) for media messages so tools (generate_image, process_gif) can reference attachments
		if (hasAnyMedia && !mediaIdHintAdded) {
			const mediaMessageIds = msg.mediaSourceMessageIds ?? [msg.id];
			const hintText =
				mediaMessageIds.length === 1
					? `[System: Media message ID for tool use: ${mediaMessageIds[0]}]`
					: `[System: Media message IDs for tool use: ${mediaMessageIds.join(", ")}]`;
			parts.push({
				type: "text",
				text: hintText,
			});
		}

		if (parts.length > 0) {
			contextItems.push({
				role,
				parts,
				metadataTag: ContextItemTag.DIALOGUE_HISTORY, // Tagging
				messageId: msg.id, // Include Discord message ID for tools
			});
		}
	}

	// Inject user impersonation system prompt as the LAST message (February 2026)
	if (isUserImpersonation && impersonatedUserId) {
		// Prioritize database nickname over Discord display name for context/messages
		// But webhook will still use Discord display name
		let nameToUse: string;
		if (impersonatedUserNickname) {
			// Use database nickname if available (e.g., "bred")
			nameToUse = impersonatedUserNickname;
		} else {
			// Fall back to Discord display name
			const guild = client.guilds.cache.get(guildId);
			const member = guild?.members.cache.get(impersonatedUserId);
			nameToUse = member?.displayName || member?.user.displayName || "User";
		}

		contextItems.push({
			role: "user",
			parts: [
				{
					type: "text",
					text: `[System: Imitate ${nameToUse}, start your message with ${nameToUse}:]`,
				},
			],
			metadataTag: ContextItemTag.DIALOGUE_HISTORY,
		});
	}

	// Add same-channel memory prompt at the very end (if it exists)
	// This ensures the prompt is the last thing the model sees before responding
	if (sameChannelMemoryPrompt) {
		contextItems.push(sameChannelMemoryPrompt);
	}

	// Add optional uncensor prompt injection as the final context item (if enabled)
	const uncensorInjectionText = buildUncensorInjectionText({
		injectionEnabled: tomoriConfig.uncensor_injection_enabled,
		unicodeSpacesEnabled: tomoriConfig.uncensor_unicode_space_enabled,
	});
	if (uncensorInjectionText) {
		contextItems.push({
			role: "user",
			parts: [{ type: "text", text: uncensorInjectionText }],
			metadataTag: ContextItemTag.DIALOGUE_HISTORY,
		});
	}

	log.info(
		`Built ${contextItems.length} structured context items for guild ${guildId}.`,
	);
	return contextItems;
}

/**
 * Fetches a user's current presence and activity information
 * @param client - Discord client for presence lookups
 * @param userId - Discord user ID to fetch presence for
 * @param guildId - Discord guild ID where the user is active
 * @param preloadedMember - Optional preloaded GuildMember to avoid redundant fetches
 * @returns A formatted string describing user's status and activities
 */
async function getUserPresenceDetails(
	client: Client,
	userId: string,
	guildId: string,
	preloadedMember?: import("discord.js").GuildMember | null,
): Promise<string> {
	try {
		log.info(`Fetching presence data for user ${userId} in guild ${guildId}`);

		// 1. Try to get the guild and member objects
		const guild = client.guilds.cache.get(guildId);
		if (!guild) {
			log.warn(`Guild ${guildId} not found in cache when fetching presence`);
			return "Status unknown";
		}

		// 2. Use preloaded member if provided, otherwise fetch with presence data
		// Preloaded member is provided for triggerer (no extra cost)
		// For non-triggerer users, this only runs in development (production skips them entirely)
		// Note: Fetching requires GUILD_PRESENCES intent to be enabled
		let member: import("discord.js").GuildMember | null = null;
		if (preloadedMember && preloadedMember.id === userId) {
			log.info(
				`Using preloaded member data for ${userId} in guild ${guild.name}`,
			);
			member = preloadedMember;
		} else {
			log.info(
				`Fetching member data for ${userId} in guild ${guild.name} (development mode)`,
			);
			member = await guild.members
				.fetch({ user: userId, force: true })
				.catch((error) => {
					log.warn(`Failed to fetch member ${userId}: ${error}`);
					return null;
				});
		}

		if (!member) {
			log.warn(`Member ${userId} not found in guild ${guild.name}`);
			return "Offline or status unknown";
		}

		log.info(`Member found: ${member.user.username} (${member.id})`);

		if (!member.presence) {
			log.warn(
				`No presence data available for ${member.user.username} (${member.id})`,
			);
			log.info(
				`Presence permission check: GUILD_PRESENCES intent enabled: ${Boolean(client.options.intents?.has(GatewayIntentBits.GuildPresences))}`,
			);
			return "Offline or status unknown";
		}

		// 3. Format the base status
		const statusMap: Record<PresenceStatus, string> = {
			online: "Online",
			idle: "Away/Idle",
			dnd: "Do Not Disturb",
			offline: "Offline",
			invisible: "Invisible",
		};

		const status = statusMap[member.presence.status] || "Status unknown";
		let result = status;

		log.info(`User ${member.user.username} status: ${status}`);

		// 4. Format activities if present
		if (member.presence.activities && member.presence.activities.length > 0) {
			log.info(
				`User ${member.user.username} has ${member.presence.activities.length} activities`,
			);

			const activityDetails = member.presence.activities.map((activity) => {
				log.info(
					`Activity found: ${activity.type} - ${activity.name} - Details: ${activity.details || "none"} - State: ${activity.state || "none"}`,
				);

				// Build activity description based on type
				switch (activity.type) {
					case 0: // Playing
						return `Playing ${activity.name}${activity.details ? ` (${activity.details})` : ""}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
					case 1: // Streaming
						return `Streaming ${activity.name}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
					case 2: // Listening
						if (
							activity.name === "Spotify" &&
							activity.details &&
							activity.state
						) {
							return `Listening to ${activity.details} by ${activity.state} on Spotify${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
						}

						if (activity.details && activity.state) {
							return `Listening to ${activity.state} - ${activity.details} on ${activity.name}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
						}
						return `Listening to ${activity.name}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
					case 3: // Watching
						return `Watching ${activity.name}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
					case 4: // Custom Status
						return activity.state || "Custom status";
					case 5: // Competing
						return `Competing in ${activity.name}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
					default:
						return activity.name;
				}
			});

			result += ` - ${activityDetails.join(", ")}`;
			log.info(`Final presence string: "${result}"`);
		} else {
			log.info(`User ${member.user.username} has no activities`);
		}

		return result;
	} catch (error) {
		log.error(`Error getting presence for user ${userId}:`, error);
		return "Status unknown";
	}
}

/**
 * Formats time spent on an activity based on start and end timestamps
 * @param startTimestamp - The activity start timestamp (as Date or number)
 * @param endTimestamp - The activity end timestamp (as Date or number, optional)
 * @returns Formatted string with time duration (e.g., "2 hours, 15 minutes")
 */
function getTimeSpent(
	startTimestamp?: Date | null | number,
	endTimestamp?: Date | null | number,
): string {
	if (!startTimestamp) {
		return "";
	}

	// Convert Date objects to timestamps if needed
	const startTime =
		startTimestamp instanceof Date
			? startTimestamp.getTime()
			: typeof startTimestamp === "number"
				? startTimestamp
				: 0;

	// If no valid start time, return empty string
	if (startTime === 0) {
		return "";
	}

	// If no end timestamp is provided, use current time
	const now = Date.now();
	const endTime =
		endTimestamp instanceof Date
			? endTimestamp.getTime()
			: typeof endTimestamp === "number"
				? endTimestamp
				: now;

	// Calculate time difference in milliseconds
	const timeDiff = endTime - startTime;

	// Convert to hours, minutes, seconds
	const seconds = Math.floor((timeDiff / 1000) % 60);
	const minutes = Math.floor((timeDiff / (1000 * 60)) % 60);
	const hours = Math.floor(timeDiff / (1000 * 60 * 60));

	// Format the time spent string
	let timeSpent = "";

	if (hours > 0) {
		timeSpent += `${hours} hour${hours !== 1 ? "s" : ""}`;
	}

	if (minutes > 0) {
		if (timeSpent) timeSpent += ", ";
		timeSpent += `${minutes} minute${minutes !== 1 ? "s" : ""}`;
	}

	if (seconds > 0 && hours === 0) {
		// Only show seconds if less than an hour
		if (timeSpent) timeSpent += ", ";
		timeSpent += `${seconds} second${seconds !== 1 ? "s" : ""}`;
	}

	return timeSpent ? ` for ${timeSpent}` : "";
}
