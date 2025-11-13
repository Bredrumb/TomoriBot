/**
 * Avatar Helper Utilities
 * Handles downloading and processing Discord avatars for preset export/import
 */

import type { Client, Guild } from "discord.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TomoriPresetRow } from "../../types/db/schema";
import { log } from "../misc/logger";

/**
 * PNG file signature (magic bytes) for format verification
 */
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Gets TomoriBot's server-specific avatar or falls back to bot's default avatar
 * @param guild - Discord Guild object (can be null for DM contexts)
 * @param client - Discord Client instance
 * @returns Promise resolving to PNG image as Buffer
 * @throws Error if avatar cannot be fetched or processed
 */
export async function getServerAvatar(
	guild: Guild | null,
	client: Client,
): Promise<Buffer> {
	try {
		let avatarUrl: string | null = null;

		// 1. Try to get TomoriBot's guild-specific avatar first
		if (guild && client.user) {
			try {
				// Fetch the bot's member object in this guild
				const botMember = await guild.members.fetch(client.user.id);

				// displayAvatarURL() prioritizes guild-specific avatar over global avatar
				avatarUrl = botMember.displayAvatarURL({
					size: 1024,
					extension: "png",
					forceStatic: true, // Always get static PNG, not animated
				});

				log.info(
					`Using TomoriBot's ${botMember.avatar ? "server-specific" : "global"} avatar for server: ${guild.name} (${guild.id})`,
				);
			} catch (error) {
				// If fetching bot member fails, fall through to default avatar
				log.warn(
					`Could not fetch bot member for guild ${guild.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		// 2. Fall back to bot's default/global avatar if no guild-specific avatar
		if (!avatarUrl && client.user) {
			avatarUrl = client.user.displayAvatarURL({
				size: 1024,
				extension: "png",
				forceStatic: true,
			});
			log.info("Using bot's default/global avatar");
		}

		// 3. Validate we have an avatar URL
		if (!avatarUrl) {
			throw new Error("Could not determine avatar URL");
		}

		// 4. Download the avatar image
		log.info(`Downloading avatar from: ${avatarUrl}`);
		const response = await fetch(avatarUrl);

		if (!response.ok) {
			throw new Error(
				`Failed to fetch avatar: ${response.status} ${response.statusText}`,
			);
		}

		// 5. Convert to Buffer
		const arrayBuffer = await response.arrayBuffer();
		const imageBuffer = Buffer.from(arrayBuffer);

		// 6. Verify it's a valid PNG
		if (!isPNGFormat(imageBuffer)) {
			log.warn("Downloaded avatar is not in PNG format, attempting conversion");
			// Note: Discord should always return PNG when we request it with extension: 'png'
			// But if somehow it doesn't, we'll just use it as-is and let PNG metadata functions handle it
		}

		log.success(`Successfully downloaded avatar (${imageBuffer.length} bytes)`);
		return imageBuffer;
	} catch (error) {
		log.error("Failed to get server avatar:", error as Error);
		throw error;
	}
}

/**
 * Checks if a buffer contains a valid PNG file
 * @param buffer - Buffer to check
 * @returns True if buffer starts with PNG signature
 */
export function isPNGFormat(buffer: Buffer): boolean {
	// 1. Check if buffer is long enough
	if (buffer.length < PNG_SIGNATURE.length) {
		return false;
	}

	// 2. Compare first 8 bytes with PNG signature
	for (let i = 0; i < PNG_SIGNATURE.length; i++) {
		if (buffer[i] !== PNG_SIGNATURE[i]) {
			return false;
		}
	}

	return true;
}

/**
 * Downloads an image from a URL and returns it as a Buffer
 * Generic utility for downloading any image, not just avatars
 * @param imageUrl - URL of the image to download
 * @returns Promise resolving to image as Buffer
 * @throws Error if download fails
 */
export async function downloadImage(imageUrl: string): Promise<Buffer> {
	try {
		log.info(`Downloading image from: ${imageUrl}`);

		// 1. Fetch the image
		const response = await fetch(imageUrl);

		if (!response.ok) {
			throw new Error(
				`Failed to download image: ${response.status} ${response.statusText}`,
			);
		}

		// 2. Convert to Buffer
		const arrayBuffer = await response.arrayBuffer();
		const imageBuffer = Buffer.from(arrayBuffer);

		log.success(`Successfully downloaded image (${imageBuffer.length} bytes)`);
		return imageBuffer;
	} catch (error) {
		log.error(`Failed to download image from ${imageUrl}:`, error as Error);
		throw error;
	}
}

/**
 * Validates that a buffer is a valid PNG file with reasonable size
 * @param buffer - Buffer to validate
 * @param maxSizeBytes - Maximum allowed file size (default: 10MB)
 * @returns Validation result object
 */
export function validatePNGBuffer(
	buffer: Buffer,
	maxSizeBytes: number = 10 * 1024 * 1024,
): {
	isValid: boolean;
	error?: string;
} {
	// 1. Check if buffer exists
	if (!buffer || buffer.length === 0) {
		return {
			isValid: false,
			error: "Buffer is empty",
		};
	}

	// 2. Check file size
	if (buffer.length > maxSizeBytes) {
		return {
			isValid: false,
			error: `File too large (${buffer.length} bytes, max: ${maxSizeBytes} bytes)`,
		};
	}

	// 3. Verify PNG format
	if (!isPNGFormat(buffer)) {
		return {
			isValid: false,
			error: "Not a valid PNG file",
		};
	}

	return {
		isValid: true,
	};
}

/**
 * In-memory cache for preset avatars as base64 data URIs
 * Key: preset_id, Value: base64 data URI string (or null if no avatar)
 */
const presetAvatarCache = new Map<number, string | null>();

/**
 * Initializes the preset avatar cache by loading all preset avatars into memory
 * This should be called once at bot startup for optimal performance
 * @param presets - Array of preset rows from the database
 */
export async function initializePresetAvatarCache(
	presets: TomoriPresetRow[],
): Promise<void> {
	try {
		log.info("Initializing preset avatar cache...");

		// 1. Clear existing cache
		presetAvatarCache.clear();

		// 2. Load each preset's avatar (if it has one)
		for (const preset of presets) {
			// Skip if no avatar path is set
			if (!preset.preset_avatar_path) {
				presetAvatarCache.set(preset.tomori_preset_id, null);
				continue;
			}

			// 3. Construct absolute path from relative path
			const absolutePath = path.join(process.cwd(), preset.preset_avatar_path);

			try {
				// 4. Read the image file
				const imageBuffer = await readFile(absolutePath);

				// 5. Validate it's a PNG
				const validation = validatePNGBuffer(imageBuffer);
				if (!validation.isValid) {
					log.warn(
						`Invalid PNG for preset "${preset.tomori_preset_name}": ${validation.error}`,
					);
					presetAvatarCache.set(preset.tomori_preset_id, null);
					continue;
				}

				// 6. Convert to base64 data URI
				const base64 = imageBuffer.toString("base64");
				const dataUri = `data:image/png;base64,${base64}`;

				// 7. Cache it
				presetAvatarCache.set(preset.tomori_preset_id, dataUri);
				log.success(
					`Cached avatar for preset "${preset.tomori_preset_name}" (${(imageBuffer.length / 1024).toFixed(2)} KB)`,
				);
			} catch (error) {
				// File doesn't exist or can't be read - cache as null
				log.warn(
					`Could not load avatar for preset "${preset.tomori_preset_name}": ${error instanceof Error ? error.message : "Unknown error"}`,
				);
				presetAvatarCache.set(preset.tomori_preset_id, null);
			}
		}

		log.success(
			`Preset avatar cache initialized with ${presetAvatarCache.size} presets`,
		);
	} catch (error) {
		log.error("Failed to initialize preset avatar cache:", error as Error);
		// Don't throw - bot should still work without cached avatars
	}
}

/**
 * Gets a cached preset avatar as a base64 data URI
 * Returns null if preset has no avatar or if avatar failed to load
 * @param presetId - ID of the preset to get avatar for
 * @returns Base64 data URI string or null
 */
export function getCachedPresetAvatar(presetId: number): string | null {
	return presetAvatarCache.get(presetId) ?? null;
}
