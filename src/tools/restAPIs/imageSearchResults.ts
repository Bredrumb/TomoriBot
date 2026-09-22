/**
 * Shared result shaping for the image-search engines.
 *
 * The Brave REST tool, the Brave MCP handler, and the SearXNG tool all answer an image
 * search by posting the images to Discord and then handing the model a headline instead
 * of the image list, which is what keeps the model from posting or describing the same
 * images twice. Each engine keeps its own wording and result shape; only the operation
 * is shared, so the provider-specific payloads stay at their own call sites.
 */

import type { ToolResult } from "@/types/tool/interfaces";

/**
 * Minimum image size in bytes, so rejects tiny placeholders and error images that
 * Discord renders as raw file attachments rather than inline media (default 5 KB).
 */
export const IMAGE_MIN_SIZE_BYTES = Math.max(
  1,
  Number.parseInt(process.env.IMAGE_MIN_SIZE_BYTES ?? "5120", 10) || 5120,
);

export type ImageSearchProvider = "brave" | "searxng";

/**
 * The headline for an image search whose attachments Discord accepted.
 *
 * It deliberately carries no image URLs or image data: the images are already in the
 * channel, so the message ID is the only handle the model needs and a list of URLs only
 * invites the model to post or describe them a second time.
 *
 * `providerPhrase` is the suffix that names the engine (" via Brave"). One engine has to
 * keep naming it and another must not start naming it, so the caller decides whether the
 * headline names anyone.
 */
export function buildImageSearchDeliveryMessage(input: {
  query: string;
  sentCount: number;
  messageId: string;
  providerPhrase: string;
  /** Extra sentence appended when the caller filtered images the model should know about. */
  note?: string;
}): string {
  const message = `Found and sent ${input.sentCount} ${input.query} images directly to Discord${input.providerPhrase} (message ID: ${input.messageId}). The images are now displayed for the user.`;
  return input.note ? `${message} ${input.note}` : message;
}

/**
 * The tool result for an image search whose engine succeeded but whose every candidate URL
 * failed validation (hotlink protection, timeouts, undersized placeholders).
 *
 * It reports success with a text listing, because an unsuccessful result sends the
 * dispatcher to the next engine and the operator sees "category unavailable" for an engine
 * that answered correctly.
 */
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
