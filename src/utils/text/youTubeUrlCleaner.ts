/**
 * YouTube URL Cleaning Utility
 * Provides functions to detect and remove YouTube URLs from text content
 *
 * Used primarily for enhanced context restart to prevent infinite loops
 * where TomoriBot keeps seeing YouTube URLs after processing them as video parts
 */

/**
 * YouTube URL detection patterns (matches those used in youTubeVideoTool.ts)
 * Supports various YouTube URL formats
 */
export const YOUTUBE_URL_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/gi,
  /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/gi,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/gi,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/gi,
];

/**
 * Extract all YouTube URLs from text content
 * @param text - Text content to search for YouTube URLs
 */
export function extractYouTubeUrls(text: string): string[] {
  const urls: string[] = [];

  for (const pattern of YOUTUBE_URL_PATTERNS) {
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: RegExp.exec() pattern requires assignment in expression
    while ((match = pattern.exec(text)) !== null) {
      urls.push(match[0]);
    }

    pattern.lastIndex = 0;
  }

  return [...new Set(urls)];
}

/**
 * Extract all YouTube video IDs from text content
 * @param text - Text content to search for YouTube URLs
 */
export function extractYouTubeVideoIds(text: string): string[] {
  const videoIds: string[] = [];

  for (const pattern of YOUTUBE_URL_PATTERNS) {
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: RegExp.exec() pattern requires assignment in expression
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) {
        videoIds.push(match[1]);
      }
    }

    pattern.lastIndex = 0;
  }

  return [...new Set(videoIds)];
}

/**
 * Remove all YouTube URLs from text content
 * Replaces YouTube URLs with optional replacement text
 * @param replacement - Optional replacement text (default: empty string)
 */
export function removeYouTubeUrls(text: string, replacement = ""): string {
  let cleanedText = text;

  for (const pattern of YOUTUBE_URL_PATTERNS) {
    pattern.lastIndex = 0;
    cleanedText = cleanedText.replace(pattern, replacement);
    pattern.lastIndex = 0;
  }

  // Clean up any extra whitespace that might result from URL removal
  return cleanedText.replace(/\s+/g, " ").trim();
}

/**
 * Replace YouTube URLs with descriptive placeholders
 * Useful for maintaining context while preventing function call loops
 * @returns Text with YouTube URLs replaced with placeholders
 */
export function replaceYouTubeUrlsWithPlaceholders(text: string, placeholder = "[YouTube video processed]"): string {
  let processedText = text;

  for (const pattern of YOUTUBE_URL_PATTERNS) {
    pattern.lastIndex = 0;

    processedText = processedText.replace(pattern, (_, videoId) => {
      if (placeholder.includes("{videoId}") && videoId) {
        return placeholder.replace("{videoId}", videoId);
      }
      return placeholder;
    });

    pattern.lastIndex = 0;
  }

  return processedText.replace(/\s+/g, " ").trim();
}

/**
 * Check if text contains any YouTube URLs
 */
export function containsYouTubeUrls(text: string): boolean {
  for (const pattern of YOUTUBE_URL_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      return true;
    }
    pattern.lastIndex = 0;
  }
  return false;
}

/**
 * Get statistics about YouTube URLs in text
 */
export function getYouTubeUrlStats(text: string): {
  urlCount: number;
  uniqueVideoIds: string[];
  urls: string[];
} {
  const urls = extractYouTubeUrls(text);
  const videoIds = extractYouTubeVideoIds(text);

  return {
    urlCount: urls.length,
    uniqueVideoIds: videoIds,
    urls: urls,
  };
}
