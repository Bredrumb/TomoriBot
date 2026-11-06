import type { Client } from "discord.js";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { LOREBOOK_CONTEXT_CHAR_BUDGET, LOREBOOK_PLACEMENT } from "@/modules/lorebooks/db/types";
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
  const activationOptions = {
    serverId,
    lineageId,
    channelId: params.channelId,
    parentChannelId: params.parentChannelId,
    channelScopeEnabled: params.channelScopeEnabled,
  };
  // Constant entries reserve their budget before keyword rolls so system content cannot change with activation.
  const constants = evaluateActiveLorebookEntries(
    entries.filter((entry) => entry.constant),
    params.recentMessages,
    activationOptions,
  );
  const activated = [
    ...constants,
    ...evaluateActiveLorebookEntries(
      entries.filter((entry) => !entry.constant),
      params.recentMessages,
      {
        ...activationOptions,
        charBudget: LOREBOOK_CONTEXT_CHAR_BUDGET - constants.reduce((total, entry) => total + entry.content.length, 0),
      },
    ),
  ];

  const items: StructuredContextItem[] = [];
  for (const constant of [true, false]) {
    for (const [placement, metadataTag] of [
      [LOREBOOK_PLACEMENT.BEFORE, ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE],
      [LOREBOOK_PLACEMENT.AFTER, ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER],
    ] as const) {
      const group = activated.filter((entry) => entry.placement === placement && entry.constant === constant);
      if (group.length === 0) continue;
      const text = `\n## World Info\n${group.map((entry) => `### ${entry.title}\n${entry.content}`).join("\n\n")}\n`;
      items.push({
        role: constant ? "system" : "user",
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
        memoryEntries: await Promise.all(
          group.map(async (entry) => ({
            id: `lorebook:${entry.entry_id}`,
            text: await params.convertMentions(
              entry.content,
              params.client,
              params.guildId,
              "User",
              params.botName,
              params.personalMemoriesEnabled,
            ),
          })),
        ),
      });
    }
  }
  return items;
}
