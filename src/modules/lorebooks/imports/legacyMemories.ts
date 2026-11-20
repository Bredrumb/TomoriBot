import {
  LOREBOOK_DEFAULT_INSERTION_ORDER,
  LOREBOOK_DEFAULT_SCAN_DEPTH,
  LOREBOOK_TITLE_MAX,
  lorebookEntryInputSchema,
  normalizeLorebookKeys,
  trimLorebookKey,
  type LorebookEntryInput,
} from "@/modules/lorebooks/db/types";

export function splitLegacyMemoryTags(tags: readonly string[]): { keys: string[]; channelTags: string[] } {
  const cleaned = tags.map(trimLorebookKey).filter(Boolean);
  return {
    keys: normalizeLorebookKeys(cleaned.filter((tag) => !tag.startsWith("#"))),
    channelTags: cleaned.filter((tag) => tag.startsWith("#")),
  };
}

export function taggedMemoryToLorebook(
  memory: { content: string; tags: string[]; channel_disc_ids?: string[]; legacy_channel_tags?: string[] },
  taggingEnabled: boolean,
): LorebookEntryInput | null {
  const { keys, channelTags } = splitLegacyMemoryTags(memory.tags);
  if (keys.length === 0) return null;
  return lorebookEntryInputSchema.parse({
    title: keys[0].slice(0, LOREBOOK_TITLE_MAX),
    content: memory.content,
    keys,
    secondary_keys: [],
    selective_logic: 0,
    scan_depth: LOREBOOK_DEFAULT_SCAN_DEPTH,
    trigger_chance: 100,
    insertion_order: LOREBOOK_DEFAULT_INSERTION_ORDER,
    placement: 0,
    constant: !taggingEnabled,
    enabled: true,
    channel_disc_ids: memory.channel_disc_ids ?? [],
    legacy_channel_tags: [...new Set([...(memory.legacy_channel_tags ?? []), ...channelTags])],
  });
}
