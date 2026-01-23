import type {
	TextChannel,
	Webhook,
	Message,
	Guild,
	MessageCreateOptions,
} from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { log } from "../misc/logger";

/**
 * In-memory webhook cache: channelId -> Webhook
 * Reduces webhook lookups and creation operations.
 * No TTL - webhooks persist unless manually deleted by users.
 */
const webhookCache = new Map<string, Webhook>();

/**
 * Webhook name used for all multi-persona responses.
 * Consistent naming makes it easier to identify and manage.
 */
const WEBHOOK_NAME = "TomoriBot Multi-Persona";

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
): Promise<Webhook | null> {
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
				return cachedWebhook;
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
		return webhook;
	} catch (error) {
		log.error(
			`[Webhook Manager] Failed to get/create webhook for channel ${channel.id}:`,
			{
				errorType: "webhook_error",
				metadata: { channelId: channel.id, channelName: channel.name, error },
			},
		);
		return null;
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

	if (hadCache) {
		log.info(`[Webhook Manager] Invalidated cache for channel ${channelId}`);
	}
}

/**
 * Clears the entire webhook cache.
 * Useful for testing or manual refresh operations.
 */
export function clearWebhookCache(): void {
	const previousSize = webhookCache.size;
	webhookCache.clear();

	log.info(
		`[Webhook Manager] Cleared entire webhook cache (${previousSize} entries)`,
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
		cacheSize: webhookCache.size,
	};
}
