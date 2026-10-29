import type { LorebookEntryInput } from "@/modules/lorebooks/db/types";

export function exportWorldInfo(entries: readonly LorebookEntryInput[], name: string) {
  return {
    name,
    entries: Object.fromEntries(
      entries.map((entry, index) => [
        String(index),
        {
          key: entry.keys,
          keysecondary: entry.secondary_keys,
          comment: entry.title,
          content: entry.content,
          constant: entry.constant,
          selective: true,
          selectiveLogic: entry.selective_logic,
          order: entry.insertion_order,
          position: entry.placement,
          disable: !entry.enabled,
          probability: entry.trigger_chance,
          useProbability: true,
          scanDepth: entry.scan_depth,
        },
      ]),
    ),
  };
}
