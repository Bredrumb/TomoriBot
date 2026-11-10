import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type TextChannel } from "discord.js";

export function createGuildTextChannel(
  id: string,
  options: { guildId?: string; everyoneCanView?: boolean; viewDenied?: boolean } = {},
): TextChannel {
  const guildId = options.guildId ?? "server-1";
  return {
    id,
    name: id,
    type: ChannelType.GuildText,
    guildId,
    guild: {
      id: guildId,
      roles: { everyone: { id: guildId } },
      channels: { cache: new Collection(), fetchActiveThreads: async () => ({ threads: new Collection() }) },
    },
    rawPosition: 0,
    parent: null,
    isDMBased: () => false,
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () =>
      new PermissionsBitField(
        options.everyoneCanView === false ? 0n : PermissionsBitField.All & ~PermissionFlagsBits.Administrator,
      ),
    permissionOverwrites: {
      cache: new Collection(
        options.viewDenied
          ? [["restricted-role", { deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) }]]
          : [],
      ),
    },
  } as unknown as TextChannel;
}
