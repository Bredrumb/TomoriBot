import { ChannelType, ComponentType } from "discord.js";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import { DISCORD_SELECT_VALUES_MAX } from "@/utils/discord/ui/componentsV2Limits";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { localizer } from "@/utils/text/localizer";

/**
 * Optional Channel Select that limits an item to the chosen channels.
 *
 * @param channelScope - Stored scope to preselect, or null outside a server, where the field is omitted
 */
export function buildChannelScopeField(
  locale: string,
  customId: string,
  labelKey: string,
  descriptionKey: string,
  channelScope: readonly string[] | null,
): RawDiscordComponent[] {
  if (!channelScope) return [];
  const component: RawDiscordComponent = {
    type: ComponentType.ChannelSelect,
    custom_id: customId,
    channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
    min_values: 0,
    max_values: DISCORD_SELECT_VALUES_MAX,
    required: false,
  };
  if (channelScope.length > 0) {
    component.default_values = channelScope
      .slice(0, DISCORD_SELECT_VALUES_MAX)
      .map((id) => ({ id, type: "channel" as const }));
  }
  return [
    {
      type: ComponentType.Label,
      label: safeSelectOptionText(localizer(locale, labelKey), 45),
      description: safeSelectOptionText(localizer(locale, descriptionKey), 100),
      component,
    },
  ];
}
