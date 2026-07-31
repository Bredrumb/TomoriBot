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
