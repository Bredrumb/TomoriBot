import { ChannelType, type Guild } from "discord.js";
import { localizer } from "@/utils/text/localizer";

const CHECKLIST_MAX_OPTIONS_PER_GROUP = 10;
const CHECKLIST_MAX_GROUPS_PER_MODAL = 5;
export const CHECKLIST_CHANNELS_PER_PAGE = CHECKLIST_MAX_OPTIONS_PER_GROUP * CHECKLIST_MAX_GROUPS_PER_MODAL;
export type ChecklistChannelTarget = {
  id: string;
  name: string;
  rawPosition: number;
  parentRawPosition: number;
};

export type BlocklistChannelTarget = {
  id: string;
  name: string;
  type: ChannelType.GuildText | ChannelType.GuildAnnouncement | ChannelType.GuildForum | ChannelType.GuildMedia;
  parentName: string | null;
  rawPosition: number;
  parentRawPosition: number;
};

export type ChannelOverrideChannelTarget = {
  id: string;
  name: string;
  type:
    | ChannelType.GuildText
    | ChannelType.GuildAnnouncement
    | ChannelType.PublicThread
    | ChannelType.PrivateThread
    | ChannelType.AnnouncementThread;
  rawPosition: number;
  parentRawPosition: number;
};

function sortChecklistChannels<T extends { name: string; rawPosition: number; parentRawPosition: number }>(
  channels: T[],
): T[] {
  return channels.sort((left, right) => {
    if (left.parentRawPosition !== right.parentRawPosition) {
      return left.parentRawPosition - right.parentRawPosition;
    }

    if (left.rawPosition !== right.rawPosition) {
      return left.rawPosition - right.rawPosition;
    }

    return left.name.localeCompare(right.name);
  });
}

function readGuildTextChecklistChannels(guild: Guild): ChecklistChannelTarget[] {
  const channels: ChecklistChannelTarget[] = [];
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText) {
      continue;
    }

    channels.push({
      id: channel.id,
      name: channel.name,
      rawPosition: channel.rawPosition,
      parentRawPosition: channel.parent?.rawPosition ?? -1,
    });
  }

  return sortChecklistChannels(channels);
}

export function loadCachedGuildTextChecklistChannels(guild: Guild): ChecklistChannelTarget[] {
  return readGuildTextChecklistChannels(guild);
}

function readGuildChannelOverrideChannels(guild: Guild): ChannelOverrideChannelTarget[] {
  const channels: ChannelOverrideChannelTarget[] = [];

  for (const channel of guild.channels.cache.values()) {
    switch (channel.type) {
      case ChannelType.GuildText:
      case ChannelType.GuildAnnouncement:
      case ChannelType.PublicThread:
      case ChannelType.PrivateThread:
      case ChannelType.AnnouncementThread:
        channels.push({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          rawPosition:
            "rawPosition" in channel && typeof channel.rawPosition === "number"
              ? channel.rawPosition
              : (channel.parent?.rawPosition ?? -1),
          parentRawPosition: channel.parent?.rawPosition ?? -1,
        });
        break;
      default:
        break;
    }
  }

  return sortChecklistChannels(channels);
}

export function loadCachedGuildChannelOverrideChannels(guild: Guild): ChannelOverrideChannelTarget[] {
  return readGuildChannelOverrideChannels(guild);
}

export function loadCachedGuildBlocklistChannels(guild: Guild): BlocklistChannelTarget[] {
  return readGuildBlocklistChannels(guild);
}

function readGuildBlocklistChannels(guild: Guild): BlocklistChannelTarget[] {
  const channels: BlocklistChannelTarget[] = [];

  for (const channel of guild.channels.cache.values()) {
    switch (channel.type) {
      case ChannelType.GuildText:
      case ChannelType.GuildAnnouncement:
      case ChannelType.GuildForum:
      case ChannelType.GuildMedia:
        channels.push({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          parentName: channel.parent?.name ?? null,
          rawPosition: channel.rawPosition,
          parentRawPosition: channel.parent?.rawPosition ?? -1,
        });
        break;
      default:
        break;
    }
  }

  return sortChecklistChannels(channels);
}

export function formatGuildBlocklistChannelOptionLabel(channel: BlocklistChannelTarget, locale: string): string {
  switch (channel.type) {
    case ChannelType.GuildForum:
      return localizer(locale, "commands.server.crosschannel-blocklist.channel_label_forum", {
        channel_name: channel.name,
      });
    case ChannelType.GuildMedia:
      return localizer(locale, "commands.server.crosschannel-blocklist.channel_label_media", {
        channel_name: channel.name,
      });
    default:
      return `#${channel.name}`;
  }
}
