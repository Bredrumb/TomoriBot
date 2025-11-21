/**
 * Tenor URL Resolver
 * Converts Tenor view URLs to direct GIF CDN URLs for proper GIF processing
 */

import { log } from "../misc/logger";

/**
 * Resolve a Tenor view URL to the direct GIF CDN URL
 *
 * @param tenorViewUrl - Tenor view URL (e.g., https://tenor.com/view/...)
 * @returns Direct GIF URL from Tenor's CDN, or null if resolution fails
 *
 * @example
 * const gifUrl = await resolveTenorUrl("https://tenor.com/view/example-gif-123");
 * // Returns: "https://media.tenor.com/example.gif"
 */
export async function resolveTenorUrl(
	tenorViewUrl: string,
): Promise<string | null> {
	try {
		log.info(`Tenor Resolver: Resolving Tenor URL: ${tenorViewUrl}`);

		// Extract the slug from the view URL for matching
		// Example: "tsukimura-dark-souls-death" from "tenor.com/view/tsukimura-dark-souls-death-...-gif-123"
		const slugMatch = tenorViewUrl.match(/\/view\/([a-zA-Z0-9%-]+)-gif-\d+/);
		const urlSlug = slugMatch?.[1] || "";

		// 1. Fetch the Tenor page HTML
		const response = await fetch(tenorViewUrl);
		if (!response.ok) {
			log.warn(
				`Tenor Resolver: Failed to fetch Tenor page: ${response.status}`,
			);
			return null;
		}

		const html = await response.text();

		// 2. Method 1 (Primary): Try to extract from <script id="gif-json"> tag
		const gifUrl = extractFromGifJson(html);
		if (gifUrl) {
			log.success(`Tenor Resolver: Resolved via JSON method: ${gifUrl}`);
			return gifUrl;
		}

		// 3. Method 2 (Fallback): Use regex to find media URLs matching the slug
		const regexMediaUrl = extractViaRegex(html, urlSlug);
		if (regexMediaUrl) {
			log.success(
				`Tenor Resolver: Resolved via regex method: ${regexMediaUrl}`,
			);
			return regexMediaUrl;
		}

		log.warn("Tenor Resolver: Could not extract GIF URL from Tenor page");
		return null;
	} catch (error) {
		log.error(
			"Tenor Resolver: Error resolving Tenor URL",
			error instanceof Error ? error : new Error(String(error)),
		);
		return null;
	}
}

/**
 * Extract GIF URL from <script id="gif-json"> JSON data (Method 1)
 */
function extractFromGifJson(html: string): string | null {
	try {
		// Look for <script id="gif-json"> tag
		const gifJsonMatch = html.match(
			/<script[^>]*id=["']gif-json["'][^>]*>(.*?)<\/script>/s,
		);

		if (!gifJsonMatch) {
			return null;
		}

		// Parse the JSON content
		const jsonContent = gifJsonMatch[1].trim();

		const gifData = JSON.parse(jsonContent);

		// Navigate to gif URL: media_formats.gif.url
		const gifUrl = gifData?.media_formats?.gif?.url;

		if (typeof gifUrl === "string" && gifUrl.endsWith(".gif")) {
			return gifUrl;
		}

		return null;
	} catch (error) {
		log.warn("Tenor Resolver: Failed to extract from gif-json", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * Extract media URL using regex pattern (Method 2 - Fallback)
 * Searches for media.tenor.com URLs matching the slug
 * @param html - The HTML content to search
 * @param urlSlug - The slug from the view URL to match against (e.g., "tsukimura-dark-souls-death")
 */
function extractViaRegex(html: string, urlSlug: string): string | null {
	try {
		// Try to find ALL media.tenor.com URLs in the HTML
		const allMediaTenorMatches = html.match(
			/https?:\/\/media\.tenor\.com\/[^\s"'<>]+\.(gif|mp4|webm|png)/gi,
		);

		if (!allMediaTenorMatches || allMediaTenorMatches.length === 0) {
			return null;
		}

		// Decode the URL slug for matching (handles URL-encoded characters)
		const decodedSlug = decodeURIComponent(urlSlug);

		// Filter URLs that match the slug from the view URL
		const matchingUrls = allMediaTenorMatches.filter((url) => {
			// Extract the filename part (without extension)
			const filename = url.split("/").pop() || "";
			const filenameWithoutExt = filename.replace(/\.(gif|mp4|webm|png)$/i, "");

			// Check if the slug contains the filename (filename is usually a subset of the full slug)
			// Example: slug "tsukimura-dark-souls-death-学園-idolmaster" contains filename "tsukimura-dark-souls-death"
			return (
				decodedSlug.includes(filenameWithoutExt) &&
				filenameWithoutExt.length > 5
			); // Ensure meaningful match (avoid short strings)
		});

		for (const url of matchingUrls) {
			log.info(`  - ${url}`);
		}

		if (matchingUrls.length > 0) {
			// Prioritize GIF format if available
			const gifUrl = matchingUrls.find((url) => url.endsWith(".gif"));
			if (gifUrl) {
				return gifUrl;
			}

			// If no GIF, return the first matching URL (likely MP4/WebM)
			return matchingUrls[0];
		}

		return null;
	} catch (error) {
		log.warn("Tenor Resolver: Regex extraction failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}
