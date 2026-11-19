import type { ToolResult } from "@/types/tool/interfaces";

// Minimum of 5 KiB applies because smaller placeholders and error images render in Discord as raw file attachments
// rather than inline media.
export const IMAGE_MIN_SIZE_BYTES = 5 * 1024;

// Both Brave and SearXNG read the BRAVE_* env vars because self-hosting docs publish those names as the configuration
// knobs.
export const IMAGE_DISCORD_LIMIT_MB = Math.max(
  1,
  Number.parseInt(process.env.BRAVE_IMAGE_DISCORD_LIMIT_MB ?? "8", 10) || 8,
);
// Aims below the upload limit so an image that compresses slightly past its target still fits.
export const IMAGE_COMPRESSION_TARGET_MB = Math.max(1, IMAGE_DISCORD_LIMIT_MB - 1);
export const IMAGE_DOWNLOAD_MAX_MB = Math.max(
  IMAGE_DISCORD_LIMIT_MB,
  Number.parseInt(process.env.BRAVE_IMAGE_DOWNLOAD_MAX_MB ?? "25", 10) || 25,
);

// Delivery message omits image URLs so the model does not repost Discord attachments, and leaves providerPhrase to
// callers because engines differ.
export function buildImageSearchDeliveryMessage(input: {
  query: string;
  sentCount: number;
  messageId: string;
  providerPhrase: string;
  note?: string;
}): string {
  const message = `Found and sent ${input.sentCount} ${input.query} images directly to Discord${input.providerPhrase} (message ID: ${input.messageId}). The images are now displayed for the user.`;
  return input.note ? `${message} ${input.note}` : message;
}

// Fallback returns success: true because failure triggers dispatcher failover to the next engine and mislogs a
// working engine as unavailable.
export function buildImageSearchTextFallback(input: {
  message: string;
  formattedResults: string;
  filteredCount: number;
}): ToolResult {
  return {
    success: true,
    message: input.message,
    data: {
      results: input.formattedResults,
      imagesFiltered: input.filteredCount,
      status: "text_fallback",
    },
  };
}
