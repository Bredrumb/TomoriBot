/**
 * Shared text-cleaning for tool-authored replies.
 *
 * Built-in tools that send Discord text on Tomori's behalf (e.g. the reply action of
 * `interact_with_recent_message`) bypass the streaming segment pipeline, where
 * `cleanLLMOutput` + guild mention resolution normally run. Without this helper, emoji
 * shortcodes (`:name:` / malformed `<:name:>`) and `@handle` mentions reach Discord as raw
 * text instead of resolved tags. This helper applies the *same* transform chain the stream
 * path uses (`segmentProcessor.sendBufferSegment`) so tool replies and normal replies render
 * identically: making it the single source of truth for both code paths.
 */

import type { ToolContext } from "@/types/tool/interfaces";
import { getKnownPersonaSpeakerNames, stripLeadingKnownSpeakerPrefixes } from "@/utils/discord/modelAuthoredText";
import { buildMentionLookup, collectPersonaNameAliases } from "@/utils/discord/stream/textConfig";
import { resolveGuildMentions } from "@/utils/discord/stream/mentionResolver";
import { filterDuplicateCustomEmojis } from "@/utils/text/emojiPenalty";
import { cleanLLMOutput } from "@/utils/text/processors/llmOutputProcessor";

/**
 * Cleans raw tool-authored reply text for Discord delivery, mirroring the streaming pipeline.
 *
 * The step order matches `StreamSegmentProcessor.sendBufferSegment`, with one tool-specific
 * addition (step 4): foreign persona speaker labels are stripped after the shared cleaner,
 * because `cleanLLMOutput` only strips the *active* persona's own-name label.
 *
 * @param content - Raw reply text supplied by the model in the tool's `content` argument
 */
export async function cleanToolReplyText(content: string, context: ToolContext): Promise<string> {
  const contextItems = context.contextItems ?? [];

  // Reuse the stream path's conversation-derived lookup so tool replies resolve
  // @mentions identically to normal replies.
  const { mentionMap, mentionIdSet, personaMentionMap } = buildMentionLookup(contextItems);

  const filtered = filterDuplicateCustomEmojis(content, contextItems);

  // Run the shared LLM-output cleaner: resolves emoji shortcodes/tags against the server
  //    emoji list, strips the active persona's own-name labels, resolves @handle mentions, and
  //    applies uncensor transforms. Runs on the still-prefixed text so own-label stripping can
  //    make its real-turn vs leaked-preamble decision correctly.
  const botName = context.personaUsername ?? context.tomoriState.persona_nickname;
  // Aliases the active persona also answers to (lore/default name + trigger words), so the cleaner
  // can peel a leaked multi-name opening label chain like "Tomori: Lilya: ...".
  const botNameAliases = collectPersonaNameAliases(context.tomoriState, botName);
  const cleaned = cleanLLMOutput(
    filtered,
    botName,
    context.emojiStrings ?? [],
    context.tomoriState.config.emoji_usage_enabled ?? true,
    mentionMap,
    mentionIdSet,
    {
      unicodeSpacesEnabled: context.tomoriState.config.uncensor_unicode_space_enabled ?? false,
      sanitizeEnabled: context.tomoriState.config.uncensor_sanitize_enabled ?? false,
    },
    botNameAliases,
    personaMentionMap,
  );

  // Strip any leading *foreign* persona speaker labels (e.g. "Bella:") that the own-name-only
  //    cleaner leaves behind, so the model is often steered to prefix its turn with a speaker name.
  const speakerNames = await getKnownPersonaSpeakerNames(context.guildId, [
    context.personaUsername,
    context.tomoriState.persona_nickname,
  ]);
  const deLabeled = stripLeadingKnownSpeakerPrefixes(cleaned, speakerNames);

  const resolved = await resolveGuildMentions(deLabeled, context.channel, mentionMap, mentionIdSet, personaMentionMap);

  return resolved.trim();
}
