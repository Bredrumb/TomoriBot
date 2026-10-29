import type { Client } from "discord.js";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { LOREBOOK_PLACEMENT } from "@/modules/lorebooks/db/types";
import { evaluateActiveLorebookEntries } from "@/modules/lorebooks/runtime/activation";
import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { MentionConverter } from "@/utils/text/context/templates";

/** Builds the placement-tagged lorebook blocks from one runtime read of Serverwide and active-persona entries. */
export async function buildLorebookContextItems(params: {
  tomoriState: TomoriState | null | undefined;
  recentMessages: readonly string[];
  channelId: string;
  parentChannelId?: string | null;
  channelScopeEnabled: boolean;
  client: Client;
  guildId: string;
  botName: string;
  personalMemoriesEnabled: boolean;
  convertMentions: MentionConverter;
}): Promise<StructuredContextItem[]> {
  const serverId = params.tomoriState?.server_id;
  if (!serverId) return [];

  const lineageId = params.tomoriState?.persona_lineage_id ?? null;
  const entries = await lorebookRepository.loadEnabledForScope(serverId, lineageId);
  const activated = evaluateActiveLorebookEntries(entries, params.recentMessages, {
    serverId,
    lineageId,
    channelId: params.channelId,
    parentChannelId: params.parentChannelId,
    channelScopeEnabled: params.channelScopeEnabled,
  });

  const items: StructuredContextItem[] = [];
  for (const [placement, metadataTag] of [
    [LOREBOOK_PLACEMENT.BEFORE, ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE],
    [LOREBOOK_PLACEMENT.AFTER, ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER],
  ] as const) {
    const group = activated.filter((entry) => entry.placement === placement);
    if (group.length === 0) continue;
    const text = `\n## World Info\n${group.map((entry) => `### ${entry.title}\n${entry.content}`).join("\n\n")}\n`;
    items.push({
      role: "system",
      parts: [
        {
          type: "text",
          text: await params.convertMentions(
            text,
            params.client,
            params.guildId,
            "User",
            params.botName,
            params.personalMemoriesEnabled,
          ),
        },
      ],
      metadataTag,
    });
  }
  return items;
}
