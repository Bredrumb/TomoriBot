import {
  ChannelType,
  Collection,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  type TextChannel,
} from "discord.js";

export function createGuildTextChannel(
  id: string,
  options: { guildId?: string; everyoneCanView?: boolean; viewDenied?: boolean; memberViewDenied?: boolean } = {},
): TextChannel {
  const guildId = options.guildId ?? "server-1";
  const overwrites: Array<[string, { type: OverwriteType; deny: PermissionsBitField }]> = [];
  if (options.viewDenied) {
    overwrites.push([
      "restricted-role",
      { type: OverwriteType.Role, deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) },
    ]);
  }
  if (options.memberViewDenied) {
    overwrites.push([
      "restricted-member",
      { type: OverwriteType.Member, deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) },
    ]);
  }
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
      cache: new Collection(overwrites),
    },
  } as unknown as TextChannel;
}
