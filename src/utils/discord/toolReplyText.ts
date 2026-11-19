import type { ToolContext } from "@/types/tool/interfaces";
import { getKnownPersonaSpeakerNames, stripLeadingKnownSpeakerPrefixes } from "@/utils/discord/modelAuthoredText";
import { buildMentionLookup, collectPersonaNameAliases } from "@/utils/discord/stream/textConfig";
import { resolveGuildMentions } from "@/utils/discord/stream/mentionResolver";
import { filterDuplicateCustomEmojis } from "@/utils/text/emojiPenalty";
import { cleanLLMOutput } from "@/utils/text/processors/llmOutputProcessor";

// Step order mirrors StreamSegmentProcessor.sendBufferSegment so tool replies match streamed formatting before
// foreign speaker labels are stripped.
export async function cleanToolReplyText(content: string, context: ToolContext): Promise<string> {
  const contextItems = context.contextItems ?? [];

  const { mentionMap, mentionIdSet, personaMentionMap } = buildMentionLookup(contextItems);

  const filtered = filterDuplicateCustomEmojis(content, contextItems);

  // Run cleanLLMOutput before stripping foreign prefixes so own-label stripping can tell a real turn from a
  // leaked preamble.
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

  // Strip foreign persona prefixes left behind by cleanLLMOutput when the model is steered to open with a
  // speaker name.
  const speakerNames = await getKnownPersonaSpeakerNames(context.guildId, [
    context.personaUsername,
    context.tomoriState.persona_nickname,
  ]);
  const deLabeled = stripLeadingKnownSpeakerPrefixes(cleaned, speakerNames);

  const resolved = await resolveGuildMentions(deLabeled, context.channel, mentionMap, mentionIdSet, personaMentionMap);

  return resolved.trim();
}
