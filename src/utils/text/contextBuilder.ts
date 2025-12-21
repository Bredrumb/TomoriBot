import type { Client, PresenceStatus } from "discord.js";
import { GatewayIntentBits } from "discord.js";
import { sql } from "../db/client"; // Import SQL client for database queries
import {
	isBlacklisted, // Import blacklist checker
	isPrivacyOptedOut, // Import privacy opt-out checker
	loadTomoriState,
	loadUserRow,
	getPendingRemindersForUser,
} from "../db/dbRead"; // Import session helpers
import {
	ContextItemTag,
	type ContextPart, // New: For text/image parts
	type StructuredContextItem, // New: The main output type
} from "../../types/misc/context";
import { registerUser } from "../db/dbWrite";
import { log } from "../misc/logger";
import { replaceTemplateVariables, humanizeString } from "./stringHelper";
import {
	getCurrentTimeWithOffset,
	formatUTCOffset,
	getTimeOfDayPhrase,
} from "./timezoneHelper";
import { HumanizerDegree, type TomoriConfigRow } from "@/types/db/schema";
import { memoryGuard, MEDIA_LIMITS } from "../security/rateLimiter";
// Import ServerEmojiRow if needed for emoji query result type
// import type { ServerEmojiRow } from "../../types/db/schema";

/**
 * Maps userId -> nickname for the current mention replacement operation.
 * @remarks This cache is cleared after each text processing run to avoid stale data.
 */
const mentionCache = new Map<string, string>();

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
	content: string | null;
	imageAttachments: Array<{
		url: string;
		proxyUrl: string;
		mimeType: string | null;
		filename: string;
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
							return `#${channel.name}`;
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

export async function buildContext({
	guildId,
	serverName,
	serverDescription,
	simplifiedMessageHistory,
	userList,
	channelDesc: _channelDesc, // Unused after Phase 1 optimization (channel info now in Users in Conversation section)
	channelName,
	client,
	triggererName,
	emojiStrings: _emojiStrings, // Unused after Phase 1 optimization (emojis fetched directly from guild cache)
	tomoriNickname,
	tomoriAttributes,
	tomoriConfig,
	isDMChannel = false,
	mediaContextWindow,
	snapshot,
}: {
	guildId: string;
	serverName: string;
	serverDescription: string | null;
	simplifiedMessageHistory: SimplifiedMessageForContext[];
	userList: string[];
	channelDesc: string | null;
	channelName: string;
	client: Client;
	triggererName: string;
	emojiStrings?: string[];
	tomoriNickname: string;
	tomoriAttributes: string[];
	tomoriConfig: TomoriConfigRow;
	isDMChannel?: boolean; // Added for DM support
	mediaContextWindow?: number; // Optional override for media window size
	snapshot?: import("../../types/misc/context").RequestSnapshot; // Optional per-request snapshot
}): Promise<StructuredContextItem[]> {
	const contextItems: StructuredContextItem[] = [];
	const botName = tomoriNickname;

	// 1. System prompt + Humanizer rules (comes FIRST for prompt optimization)
	if (tomoriConfig.humanizer_degree >= HumanizerDegree.LIGHT) {
		const systemPrompt = tomoriConfig.system_prompt?.trim() || DEFAULT_SYSTEM_PROMPT;
		let humanizerText = systemPrompt;

		// Add mention instruction (moved here from personality section)
		humanizerText += `\nWhen ${botName} wants to mention and ping a specific user in their response, they MUST use the format <@ > with the user's ID (e.g., <@123456789012345678>). The user's ID can be found in the user's status block in this context (e.g., "Nickname (User ID: 123...)"). This ensures the user gets a notification.`;

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
		const serverMemoriesText = `${memoryLabel}${tomoriState.server_memories.join("\n")}\n`;
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

	// 5. Emojis with Semantic Metadata (only available in guild channels, not DMs)
	// CRITICAL: Text-based format with LLM-generated descriptions and emotion keys
	// Kept in system instruction for better caching (deterministic ordering prevents frequent invalidation)
	if (!isDMChannel) {
		const guild = client.guilds.cache.get(guildId);
		const serverEmojis = guild?.emojis.cache;

		if (serverEmojis && serverEmojis.size > 0 && tomoriState) {
			// 1. Load emoji metadata from database (with descriptions and emotion keys)
			const serverId = tomoriState.server_id;
			const emojiMetadata = await sql<
				Array<{
					emoji_disc_id: string;
					emoji_name: string;
					emoji_desc: string | null;
					emotion_key: string | null;
					is_animated: boolean;
				}>
			>`
				SELECT emoji_disc_id, emoji_name, emoji_desc, emotion_key, is_animated
				FROM server_emojis
				WHERE server_id = ${serverId}
				ORDER BY created_at ASC
			`;

			// 2. Create emoji map for quick lookup
			const emojiMap = new Map(
				emojiMetadata.map((e) => [e.emoji_disc_id, e]),
			);

			// 3. Sort emojis by creation date (deterministic, oldest first for caching stability)
			const sortedEmojis = Array.from(serverEmojis.values()).sort((a, b) => {
				const aTime = a.createdTimestamp || 0;
				const bTime = b.createdTimestamp || 0;
				return aTime - bTime; // Ascending order (oldest first)
			});

			// 4. Build emoji list with descriptions and emotion keys
			const emojiLines: string[] = [];
			for (const emoji of sortedEmojis) {
				const metadata = emojiMap.get(emoji.id);
				const prefix = emoji.animated ? "a:" : ":";
				const emojiCode = `<${prefix}${emoji.name}:${emoji.id}>`;
				const emotionKey =
					metadata?.emotion_key === "unset" ? null : metadata?.emotion_key ?? null;

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
			const emojiUsage = `\nIn order to use ${serverName}'s Emojis, input the name and the code like such: <:name:numbercode>\nAnimated emojis require an 'a' flag in the beginning like such: <a:name:numbercode>. {bot} only uses server emojis when it matches their actual mood.\n`;

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
		const serverStickers = guild?.stickers.cache;

		if (serverStickers && serverStickers.size > 0 && tomoriState) {
			// 1. Load sticker metadata from database (with descriptions and emotion keys)
			const serverId = tomoriState.server_id;
			const stickerMetadata = await sql<
				Array<{
					sticker_disc_id: string;
					sticker_name: string;
					sticker_desc: string | null;
					emotion_key: string | null;
				}>
			>`
				SELECT sticker_disc_id, sticker_name, sticker_desc, emotion_key
				FROM server_stickers
				WHERE server_id = ${serverId}
				ORDER BY created_at ASC
			`;

			// 2. Create sticker map for quick lookup
			const stickerMap = new Map(
				stickerMetadata.map((s) => [s.sticker_disc_id, s]),
			);

			// 3. Sort stickers by creation date (deterministic, oldest first for caching stability)
			const sortedStickers = Array.from(serverStickers.values()).sort(
				(a, b) => {
					const aTime = a.createdTimestamp || 0;
					const bTime = b.createdTimestamp || 0;
					return aTime - bTime; // Ascending order (oldest first)
				},
			);

			// 4. Build sticker list with descriptions and emotion keys
			let stickerContent = `## ${serverName}'s Stickers\nThis server has the following stickers available for ${botName} to use with the 'select_sticker_for_response' function:\n`;

			for (const sticker of sortedStickers) {
				const metadata = stickerMap.get(sticker.id);
				const discordDesc = sticker.description
					? `, Description/Usage: "${sticker.description}"`
					: "";
				const emotionKey =
					metadata?.emotion_key === "unset" ? null : metadata?.emotion_key ?? null;

				// Build sticker entry
				let stickerEntry = `- Name: "${sticker.name}", ID: "${sticker.id}"`;

				// Add LLM-generated metadata if available
				if (metadata && (metadata.sticker_desc || emotionKey)) {
					const labelParts: string[] = [];
					if (emotionKey) {
						labelParts.push(`Expresses ${emotionKey}`);
					}
					if (metadata.sticker_desc) {
						labelParts.push(metadata.sticker_desc);
					}
					const label = ` (${labelParts.join("; ")})`;
					stickerEntry += label;
				}

				// Add Discord description at the end
				stickerEntry += `${discordDesc}\n`;
				stickerContent += stickerEntry;
			}

			stickerContent += `To use a sticker, the 'select_sticker_for_response' function should be called with the exact 'sticker_id' of the desired sticker.\n`;

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

	// 7. Users in Conversation (ALL user-specific dynamic data)
	// This section combines: time/date, channel, user status, memories, and reminders
	if (userList.length > 0) {
		// 1. Get timezone info
		const timezoneOffset = tomoriConfig.timezone_offset ?? 0;
		const currentTime = getCurrentTimeWithOffset(timezoneOffset);
		const timezoneLabel = formatUTCOffset(timezoneOffset);
		const timeOfDayPhrase = getTimeOfDayPhrase(timezoneOffset);

		let usersInConversationText = "";

		// 2. Header with time/channel info
		if (isDMChannel) {
			usersInConversationText = `[System: At ${currentTime} (${timezoneLabel}), ${timeOfDayPhrase}, the following users are having a Direct Message conversation:\n\n`;
		} else {
			usersInConversationText = `[System: In #${channelName} at ${currentTime} (${timezoneLabel}), ${timeOfDayPhrase}, the following users are having a conversation:\n\n`;
		}

		// 3. Process each user (including bot itself)
		for (const userIdToProcess of userList) {
			// 4. Special handling for TomoriBot itself
			if (client.user && userIdToProcess === client.user.id) {
				usersInConversationText += `${botName} (User ID: ${userIdToProcess}) (This is you!)\n`;
				usersInConversationText += `- Status: Online - Currently active and responding to messages\n\n`;
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
			const serverPersonalizationEnabled =
				tomoriConfig.personal_memories_enabled ?? true;
			const isTriggererId =
				snapshot?.triggererUserRow?.user_disc_id === userRow.user_disc_id;
			const userIsBlacklisted = isTriggererId
				? (snapshot?.isTriggererBlacklisted ?? false)
				: await isBlacklisted(guildId, userRow.user_disc_id);
			const userOptedOut = isTriggererId
				? (snapshot?.isTriggererOptedOut ?? false)
				: await isPrivacyOptedOut(userRow.user_disc_id);

			let displayName: string;
			const customNickname = userRow.user_nickname;
			const serverNickname = member?.nickname;

			if (
				customNickname &&
				serverPersonalizationEnabled &&
				!userIsBlacklisted &&
				!userOptedOut
			) {
				displayName = serverNickname
					? `${customNickname} (Server Nickname: "${serverNickname}")`
					: customNickname;
			} else if (serverNickname) {
				displayName = serverNickname;
			} else {
				displayName = `<@${userRow.user_disc_id}>`;
			}

			// 7. Add user header
			usersInConversationText += `${displayName} (User ID: ${userRow.user_disc_id})\n`;

			// 8. Add status (production: triggerer only, dev: all users)
			const isProduction = process.env.RUN_ENV === "production";
			const presenceInfo = isDMChannel
				? "Online (Direct Message)"
				: isTriggererId
					? await getUserPresenceDetails(
							client,
							userRow.user_disc_id,
							guildId,
							snapshot?.preloadedMember,
						)
					: isProduction
						? "Status unknown"
						: await getUserPresenceDetails(
								client,
								userRow.user_disc_id,
								guildId,
							);

			usersInConversationText += `- Status: ${presenceInfo}\n`;

			// 9. Add personal memories (if personalization enabled and user not blacklisted/opted-out)
			if (
				serverPersonalizationEnabled &&
				!userIsBlacklisted &&
				!userOptedOut
			) {
				if (userRow.personal_memories && userRow.personal_memories.length > 0) {
					const processedMemories = await Promise.all(
						userRow.personal_memories.map((memory) =>
							convertMentions(
								memory,
								client,
								guildId,
								displayName, // Use memory owner's name for {user} token
								botName,
								tomoriConfig.personal_memories_enabled,
							),
						),
					);
					usersInConversationText += `- Memories: ${processedMemories.join(", ")}\n`;
				}
			}

			// 10. Add pending reminders
			const pendingReminders = await getPendingRemindersForUser(
				userRow.user_disc_id,
				guildId,
			);
			if (pendingReminders && pendingReminders.length > 0) {
				usersInConversationText += `- Reminders:\n`;
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
					usersInConversationText += `  • "${reminder.reminder_purpose}" (scheduled for ${formattedTime})\n`;
				}
			}

			usersInConversationText += "\n"; // Blank line between users
		}

		usersInConversationText += "]"; // Close [System: ...] block

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

	if (
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
						text: await convertMentions(
							userSampleText,
							client,
							guildId,
							triggererName, // triggererName for {user} if it appears in sample
							botName,
							tomoriConfig.personal_memories_enabled,
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
						text: await convertMentions(
							modelSampleText,
							client,
							guildId,
							triggererName,
							botName, // botName for {bot} if it appears in sample
							tomoriConfig.personal_memories_enabled,
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

	for (const [index, msg] of simplifiedMessageHistory.entries()) {
		const role = msg.authorId === client.user?.id ? "model" : "user";
		const parts: ContextPart[] = [];

		// Determine if this message is within the media context window
		const isWithinMediaWindow = index >= mediaWindowCutoff;

		// Check if message has media (images or videos)
		const hasMedia =
			msg.imageAttachments.length > 0 || msg.videoAttachments.length > 0;
		let mediaIdHintAdded = false;

		// If message has media but is outside window, add placeholder
		if (hasMedia && !isWithinMediaWindow) {
			// Calculate extend_by needed to reach this message, capped at maxExtendBy
			const extendByNeeded = Math.min(mediaWindowCutoff - index, maxExtendBy);

			// Build media description
			const mediaDescription = buildMediaDescription(msg);

			// Add placeholder text
			parts.push({
				type: "text",
				text: `[This message (ID: ${msg.id}) contained ${mediaDescription} - use increase_media_context with extend_by=${extendByNeeded} to view]`,
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
			let processedContent = `${msg.authorName}: ${msg.content}`;

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
			parts.push({ type: "text", text: processedContent });
		}

		// Expose message ID for media messages so tools (generate_image, process_gif) can reference attachments
		if (hasMedia && !mediaIdHintAdded) {
			parts.push({
				type: "text",
				text: `[System: Media message ID for tool use: ${msg.id}]`,
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
