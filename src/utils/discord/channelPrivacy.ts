import { ChannelType, OverwriteType, PermissionFlagsBits, type Channel } from "discord.js";

export type ChannelPrivacyReason = "manual" | "private_thread" | "restricted" | "unknown";

export function getChannelPrivacyReason(
  channel: Channel | null | undefined,
  privateChannelIds: readonly string[] = [],
): ChannelPrivacyReason | null {
  if (!channel) return "unknown";
  if (privateChannelIds.includes(channel.id)) return "manual";
  if (channel.isDMBased()) return "restricted";
  if (channel.type === ChannelType.PrivateThread) return "private_thread";

  const audience = channel.isThread() ? channel.parent : channel;
  if (!audience || !("permissionOverwrites" in audience)) return "unknown";
  if (privateChannelIds.includes(audience.id)) return "manual";
  if (
    !audience.permissionsFor(audience.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) ||
    audience.permissionOverwrites.cache.some(
      (overwrite) => overwrite.type === OverwriteType.Role && overwrite.deny.has(PermissionFlagsBits.ViewChannel),
    )
  ) {
    return "restricted";
  }
  return null;
}
