import type {
	TextChannel,
	Webhook,
	Message,
	Guild,
	MessageCreateOptions,
} from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { log } from "../misc/logger";
import { safeDownload } from "../security/safeDownload";
import { PERSONA_LIMITS } from "../security/rateLimiter";
import { convertToPNG } from "../image/imageProcessor";

/**
 * In-memory webhook cache: channelId -> Webhook
 * Reduces webhook lookups and creation operations.
 * No TTL - webhooks persist unless manually deleted by users.
 */
const webhookCache = new Map<string, Webhook>();

/**
 * In-memory persona webhook cache: channelId:personaId -> Webhook
 * Used for non-production per-persona webhook avatars.
 */
const personaWebhookCache = new Map<string, Webhook>();

/**
 * Webhook name used for all multi-persona responses.
 * Consistent naming makes it easier to identify and manage.
 */
const WEBHOOK_NAME = "TomoriBot Multi-Persona";
const PERSONA_WEBHOOK_PREFIX = "TomoriBot Persona";

export type WebhookCreateErrorReason =
	| "missing_permissions"
	| "max_webhooks"
	| "unknown";

export type WebhookCreateResult = {
	webhook: Webhook | null;
	errorReason?: WebhookCreateErrorReason;
};

const MAX_AVATAR_SIZE_BYTES =
	PERSONA_LIMITS.MAX_AVATAR_SIZE_MB * 1024 * 1024;

function getPersonaWebhookName(personaId: number): string {
	return `${PERSONA_WEBHOOK_PREFIX} ${personaId}`;
}

function getPersonaWebhookCacheKey(channelId: string, personaId: number): string {
	return `${channelId}:${personaId}`;
}

function getWebhookErrorReason(error: unknown): WebhookCreateErrorReason {
	const code = (error as { code?: number | string })?.code;

	if (code === 50013 || code === "50013") {
		return "missing_permissions";
	}

	if (code === 30007 || code === "30007") {
		return "max_webhooks";
	}

	return "unknown";
}

function isValidHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

async function resolvePersonaWebhookAvatar(
	persona: TomoriState,
): Promise<string | undefined> {
	if (!persona.webhook_avatar_url) {
		return undefined;
	}

	if (!isValidHttpUrl(persona.webhook_avatar_url)) {
		log.warn(
			`[Webhook Manager] Invalid avatar URL for persona ${persona.tomori_nickname}`,
		);
		return undefined;
	}

	const downloadResult = await safeDownload(persona.webhook_avatar_url, {
		maxSizeMB: PERSONA_LIMITS.MAX_AVATAR_SIZE_MB,
	});

	if (!downloadResult.success || !downloadResult.buffer) {
		log.warn(
			`[Webhook Manager] Failed to download avatar for persona ${persona.tomori_nickname}: ${downloadResult.error ?? "unknown error"}`,
		);
		return undefined;
	}

	let buffer = downloadResult.buffer;
	if (buffer.length > MAX_AVATAR_SIZE_BYTES) {
		log.warn(
			`[Webhook Manager] Persona avatar exceeds max size (${buffer.length} bytes)`,
		);
		return undefined;
	}

	try {
		buffer = await convertToPNG(buffer);
	} catch (error) {
		log.warn(
			`[Webhook Manager] Failed to convert persona avatar to PNG for ${persona.tomori_nickname}`,
			error,
		);
		return undefined;
	}

	const base64 = buffer.toString("base64");
	return `data:image/png;base64,${base64}`;
}

/**
 * Gets or creates a webhook for the given channel with in-memory caching.
 * Webhooks are used to send messages with custom avatars and usernames for alter personas.
 *
 * Flow:
 * 1. Check in-memory cache
 * 2. If cached webhook still exists, return it
 * 3. If not cached or deleted, fetch existing webhook by name
 * 4. If no webhook exists, create new one
 * 5. Cache the webhook for future use
 *
 * @param channel - The text channel to get/create webhook for
 * @returns Webhook object, or null if missing permissions
 */
export async function getOrCreateWebhook(
	channel: TextChannel,
): Promise<WebhookCreateResult> {
	try {
		const channelId = channel.id;

		// 1. Check in-memory cache
		const cachedWebhook = webhookCache.get(channelId);
		if (cachedWebhook) {
			// Verify cached webhook still has a valid token (not deleted)
			if (!cachedWebhook.token) {
				log.warn(
					`[Webhook Manager] Cached webhook for channel ${channelId} has no token (likely deleted), invalidating cache`,
				);
				webhookCache.delete(channelId);
				// Continue to fetch/create a new webhook
			} else {
				// Return cached webhook
				log.info(
					`[Webhook Manager] Cache HIT for channel ${channelId} (${channel.name})`,
				);
				return { webhook: cachedWebhook };
			}
		}

		// 2. Fetch existing webhook by name
		log.info(
			`[Webhook Manager] Cache MISS for channel ${channelId}, fetching webhooks`,
		);
		const webhooks = await channel.fetchWebhooks();
		let webhook = webhooks.find((wh) => wh.name === WEBHOOK_NAME);

		// 3. Create new webhook if none exists
		if (!webhook) {
			log.info(
				`[Webhook Manager] No webhook found for channel ${channelId}, creating new one`,
			);
			webhook = await channel.createWebhook({
				name: WEBHOOK_NAME,
				reason: "TomoriBot multi-persona support",
			});
			log.success(
				`[Webhook Manager] Created webhook for channel ${channelId} (${channel.name})`,
			);
		}

		// 4. Cache the webhook
		webhookCache.set(channelId, webhook);
		return { webhook };
	} catch (error) {
		const errorReason = getWebhookErrorReason(error);
		log.error(
			`[Webhook Manager] Failed to get/create webhook for channel ${channel.id}:`,
			{
				errorType: "webhook_error",
				metadata: { channelId: channel.id, channelName: channel.name, error },
			},
		);
		return { webhook: null, errorReason };
	}
}

/**
 * Gets or creates a webhook for a specific persona in a channel.
 * Used in non-production to avoid external avatar hosting.
 */
export async function getOrCreatePersonaWebhook(
	channel: TextChannel,
	persona: TomoriState,
): Promise<WebhookCreateResult> {
	try {
		if (!persona.tomori_id) {
			log.warn(
				`[Webhook Manager] Missing tomori_id for persona ${persona.tomori_nickname}, cannot create persona webhook.`,
			);
			return { webhook: null, errorReason: "unknown" };
		}

		const channelId = channel.id;
		const cacheKey = getPersonaWebhookCacheKey(channelId, persona.tomori_id);

		const cachedWebhook = personaWebhookCache.get(cacheKey);
		if (cachedWebhook) {
			if (!cachedWebhook.token) {
				log.warn(
					`[Webhook Manager] Cached persona webhook for channel ${channelId} has no token (likely deleted), invalidating cache`,
				);
				personaWebhookCache.delete(cacheKey);
			} else {
				log.info(
					`[Webhook Manager] Persona cache HIT for channel ${channelId} (persona ${persona.tomori_id})`,
				);
				return { webhook: cachedWebhook };
			}
		}

		log.info(
			`[Webhook Manager] Persona cache MISS for channel ${channelId}, fetching webhooks`,
		);
		const webhooks = await channel.fetchWebhooks();
		const personaWebhookName = getPersonaWebhookName(persona.tomori_id);
		let webhook = webhooks.find((wh) => wh.name === personaWebhookName);

		if (!webhook) {
			const avatar = await resolvePersonaWebhookAvatar(persona);
			log.info(
				`[Webhook Manager] No persona webhook found for channel ${channelId}, creating new one`,
			);
			webhook = await channel.createWebhook({
				name: personaWebhookName,
				avatar,
				reason: "TomoriBot persona avatar support",
			});
			log.success(
				`[Webhook Manager] Created persona webhook for channel ${channelId} (${channel.name})`,
			);
		}

		personaWebhookCache.set(cacheKey, webhook);
		return { webhook };
	} catch (error) {
		const errorReason = getWebhookErrorReason(error);
		log.error(
			`[Webhook Manager] Failed to get/create persona webhook for channel ${channel.id}:`,
			{
				errorType: "webhook_error",
				metadata: { channelId: channel.id, channelName: channel.name, error },
			},
		);
		return { webhook: null, errorReason };
	}
}

/**
 * Sends a message via webhook with persona-specific avatar and username.
 * Used for multi-persona responses to show different avatars per persona.
 *
 * Avatar resolution priority:
 * 1. Alter personas: Use webhook_avatar_url from database
 * 2. Main persona: Use guild avatar or fallback to webhook_avatar_url
 * 3. Fallback: Use bot's global avatar (webhook default)
 *
 * @param webhook - The webhook to send through
 * @param persona - The persona to send as
 * @param content - Message content
 * @param options - Additional options (replyToMessageId, custom avatarURL override)
 * @returns The sent message, or null if failed
 */
export async function sendAsPersona(
	webhook: Webhook,
	persona: TomoriState,
	content: string,
	options?: {
		replyToMessageId?: string;
		avatarURL?: string;
		files?: MessageCreateOptions["files"];
		embeds?: MessageCreateOptions["embeds"];
		components?: MessageCreateOptions["components"];
	},
): Promise<Message | null> {
	try {
		// Resolve avatar URL based on persona type
		let avatarURL = options?.avatarURL;

		if (!avatarURL) {
			if (persona.is_alter) {
				// Alter persona: Use webhook_avatar_url from database
				avatarURL = persona.webhook_avatar_url ?? undefined;
			} else {
				// Main persona: Try to get guild avatar
				// Note: Guild avatar is set during persona swap, so we rely on webhook_avatar_url
				avatarURL = persona.webhook_avatar_url ?? undefined;
			}
		}

		// Fallback: If no avatar URL, webhook will use bot's global avatar automatically

		// Send message via webhook
		const message = await webhook.send({
			content,
			username: persona.tomori_nickname,
			avatarURL,
			allowedMentions: {
				parse: ["users", "roles"],
				repliedUser: true,
			},
			...(options?.replyToMessageId && {
				reply: {
					messageReference: options.replyToMessageId,
					failIfNotExists: false,
				},
			}),
			...(options?.files && { files: options.files }),
			...(options?.embeds && { embeds: options.embeds }),
			...(options?.components && { components: options.components }),
		});

		log.info(
			`[Webhook Manager] Sent message as persona ${persona.tomori_nickname} (${persona.is_alter ? "alter" : "main"})`,
		);
		return message;
	} catch (error) {
		log.error(
			`[Webhook Manager] Failed to send message as persona ${persona.tomori_nickname}:`,
			{
				errorType: "webhook_send_error",
				metadata: {
					personaId: persona.tomori_id,
					personaName: persona.tomori_nickname,
					isAlter: persona.is_alter,
					error,
				},
			},
		);
		return null;
	}
}

/**
 * Resolves the avatar URL for a given persona and guild.
 * Handles fallback chain: alter avatar -> guild avatar -> default avatar.
 *
 * @param persona - The persona to resolve avatar for
 * @param guild - The guild context (for main persona guild avatar)
 * @returns Avatar URL string, or undefined to use webhook default
 */
export function resolvePersonaAvatarURL(
	persona: TomoriState,
	guild: Guild,
): string | undefined {
	// Helper function to validate avatar URL
	const validateAvatarURL = (url: string): string | undefined => {
		try {
			const parsedURL = new URL(url);
			// Only allow http and https protocols for security
			if (parsedURL.protocol !== "http:" && parsedURL.protocol !== "https:") {
				log.warn(
					`[Webhook Manager] Invalid avatar URL protocol for persona ${persona.tomori_nickname}: ${parsedURL.protocol}`,
					{
						metadata: {
							personaId: persona.tomori_id,
							protocol: parsedURL.protocol,
						},
					},
				);
				return undefined;
			}
			return url;
		} catch (error) {
			log.warn(
				`[Webhook Manager] Invalid avatar URL for persona ${persona.tomori_nickname}`,
				{
					metadata: {
						personaId: persona.tomori_id,
						url,
						error,
					},
				},
			);
			return undefined;
		}
	};

	// 1. Alter personas: Use webhook_avatar_url from database
	if (persona.is_alter && persona.webhook_avatar_url) {
		const validatedURL = validateAvatarURL(persona.webhook_avatar_url);
		if (validatedURL) {
			return validatedURL;
		}
	}

	// 2. Main persona: Try guild avatar first
	if (!persona.is_alter) {
		const guildAvatar = guild.iconURL({ extension: "png", size: 256 });
		if (guildAvatar) {
			return guildAvatar;
		}

		// Fallback to webhook_avatar_url if guild has no icon
		if (persona.webhook_avatar_url) {
			const validatedURL = validateAvatarURL(persona.webhook_avatar_url);
			if (validatedURL) {
				return validatedURL;
			}
		}
	}

	// 3. Fallback: undefined = use webhook's default avatar (bot's global avatar)
	return undefined;
}

/**
 * Invalidates the webhook cache for a specific channel.
 * Useful when webhooks are manually deleted or need to be refreshed.
 *
 * @param channelId - The channel ID to invalidate cache for
 */
export function invalidateWebhookCache(channelId: string): void {
	const hadCache = webhookCache.has(channelId);
	webhookCache.delete(channelId);
	const personaCacheRemoved = invalidatePersonaWebhookCacheForChannel(channelId);

	if (hadCache || personaCacheRemoved > 0) {
		log.info(`[Webhook Manager] Invalidated cache for channel ${channelId}`);
	}
}

function invalidatePersonaWebhookCacheForChannel(channelId: string): number {
	let removed = 0;
	const prefix = `${channelId}:`;
	for (const key of personaWebhookCache.keys()) {
		if (key.startsWith(prefix)) {
			personaWebhookCache.delete(key);
			removed++;
		}
	}
	return removed;
}

export function invalidatePersonaWebhookCacheForPersona(
	personaId: number,
): number {
	let removed = 0;
	const suffix = `:${personaId}`;
	for (const key of personaWebhookCache.keys()) {
		if (key.endsWith(suffix)) {
			personaWebhookCache.delete(key);
			removed++;
		}
	}
	if (removed > 0) {
		log.info(
			`[Webhook Manager] Invalidated persona webhook cache for persona ${personaId}`,
		);
	}
	return removed;
}

/**
 * Clears the entire webhook cache.
 * Useful for testing or manual refresh operations.
 */
export function clearWebhookCache(): void {
	const previousSize = webhookCache.size;
	webhookCache.clear();
	const personaSize = personaWebhookCache.size;
	personaWebhookCache.clear();

	log.info(
		`[Webhook Manager] Cleared entire webhook cache (${previousSize + personaSize} entries)`,
	);
}

/**
 * Gets webhook cache statistics for monitoring.
 *
 * @returns Object with cache size
 */
export function getWebhookCacheStats(): {
	cacheSize: number;
} {
	return {
		cacheSize: webhookCache.size + personaWebhookCache.size,
	};
}

/**
 * Deletes persona-specific webhooks across all channels in a guild.
 * Used when removing an alter persona in non-production mode.
 *
 * @param guild - Guild to scan for webhooks
 * @param personaId - Persona ID to delete webhooks for
 * @returns Number of webhooks deleted
 */
export async function deletePersonaWebhooks(
	guild: Guild,
	personaId: number,
): Promise<number> {
	const personaWebhookName = getPersonaWebhookName(personaId);
	let deletedCount = 0;

	invalidatePersonaWebhookCacheForPersona(personaId);

	for (const channel of guild.channels.cache.values()) {
		if (!channel.isTextBased()) {
			continue;
		}

		if (!("fetchWebhooks" in channel)) {
			continue;
		}

		try {
			const webhooks = await (channel as TextChannel).fetchWebhooks();
			const matching = webhooks.filter((wh) => wh.name === personaWebhookName);

			for (const webhook of matching.values()) {
				await webhook.delete("Persona removed");
				deletedCount++;
			}

			const cacheKey = getPersonaWebhookCacheKey(channel.id, personaId);
			personaWebhookCache.delete(cacheKey);
		} catch (error) {
			log.warn(
				`[Webhook Manager] Failed to delete persona webhook in channel ${channel.id}`,
				error,
			);
		}
	}

	if (deletedCount > 0) {
		log.info(
			`[Webhook Manager] Deleted ${deletedCount} persona webhook(s) for persona ${personaId}`,
		);
	}

	return deletedCount;
}
