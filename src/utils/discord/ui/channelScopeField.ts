import { ChannelType, ComponentType } from "discord.js";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import { DISCORD_SELECT_VALUES_MAX } from "@/utils/discord/ui/componentsV2Limits";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { localizer } from "@/utils/text/localizer";

// A null channelScope signals a non-server context so the channel select is omitted instead of rendering an empty
// selection.
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
