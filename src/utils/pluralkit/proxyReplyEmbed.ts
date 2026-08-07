/**
 * Recognizes the reply embed PluralKit attaches to a proxied message.
 *
 * Webhook messages cannot carry a native reply reference, so PluralKit encodes
 * the reply as an embed instead: `author.name` is the replied-to member's name
 * followed by U+21A9, and the description carries a jump link to the quoted
 * message. The chat pipeline reconstructs that same relationship from the
 * pre-proxy original (see `applyPluralKitProxyReference`), so leaving the embed
 * in place would state the reply to the model twice.
 */

import type { Embed } from "discord.js";

/** PluralKit appends U+21A9, which most clients send with the emoji variation selector. */
const PLURALKIT_REPLY_AUTHOR_SUFFIX_PATTERN = /↩️?$/;

const DISCORD_MESSAGE_LINK_PATTERN = /discord(?:app)?\.com\/channels\/(?:@me|\d+)\/(\d+)\/(\d+)/;

export type PluralKitReplyTarget = { channelId: string; messageId: string };

/**
 * Reads the quoted message coordinates out of a PluralKit reply embed.
 *
 * Requires both the author suffix and a jump link so an ordinary link preview
 * that happens to end in U+21A9 is never mistaken for a reply marker.
 *
 * @returns The replied-to message's channel and message IDs, or null when the
 *          embed is not a PluralKit reply embed.
 */
export function extractPluralKitReplyTarget(embed: Pick<Embed, "author" | "description">): PluralKitReplyTarget | null {
  const authorName = embed.author?.name?.trim() ?? "";
  if (!PLURALKIT_REPLY_AUTHOR_SUFFIX_PATTERN.test(authorName)) {
    return null;
  }

  const match = `${embed.author?.url ?? ""}\n${embed.description ?? ""}`.match(DISCORD_MESSAGE_LINK_PATTERN);
  if (!match) {
    return null;
  }

  return { channelId: match[1], messageId: match[2] };
}

export function isPluralKitReplyEmbed(embed: Pick<Embed, "author" | "description">): boolean {
  return extractPluralKitReplyTarget(embed) !== null;
}
