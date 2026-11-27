import { type GuildBasedChannel, type GuildMember, PermissionFlagsBits } from "discord.js";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import { getBlockedSendRetryAt } from "@/utils/discord/stream/sendFailureCache";

export type BotSendBlock =
  | { reason: "missing_channel_permissions" | "cannot_send_in_channel" }
  | { reason: "bot_timed_out_in_guild" | "recent_send_refused"; until: number };

type BotSendBlockNotice = Required<Pick<StandardEmbedOptions, "titleKey" | "descriptionKey">> &
  Pick<StandardEmbedOptions, "descriptionVars">;

export function resolveBotSendBlock(channel: GuildBasedChannel, me: GuildMember | null): BotSendBlock | null {
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!me || !permissions) {
    return { reason: "missing_channel_permissions" };
  }

  const sendPermission = channel.isThread()
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages;
  // discord.js omits Discord's implicit denial of every permission without View Channel, so private channels
  // still report the send bit.
  if (!permissions.has([PermissionFlagsBits.ViewChannel, sendPermission])) {
    return { reason: "cannot_send_in_channel" };
  }

  // Timed-out members retain all permission bits even though Discord rejects sends with 50013, so check timeout
  // state on the cached member, which the GuildMembers intent keeps current.
  if (me.isCommunicationDisabled()) {
    return { reason: "bot_timed_out_in_guild", until: me.communicationDisabledUntilTimestamp };
  }

  // Reactive backstop for unseen send refusals (cleared once a send lands) when permission and timeout checks
  // still pass.
  const retryAt = getBlockedSendRetryAt(channel.id);
  if (retryAt !== null) {
    return { reason: "recent_send_refused", until: retryAt };
  }

  return null;
}

export function botSendBlockNotice(block: BotSendBlock): BotSendBlockNotice {
  switch (block.reason) {
    case "missing_channel_permissions":
      return {
        titleKey: "commands.shared.send_blocked.cannot_send_title",
        descriptionKey: "commands.shared.send_blocked.missing_permissions_description",
      };
    case "cannot_send_in_channel":
      return {
        titleKey: "commands.shared.send_blocked.cannot_send_title",
        descriptionKey: "commands.shared.send_blocked.cannot_send_description",
      };
    case "bot_timed_out_in_guild":
      return {
        titleKey: "commands.shared.send_blocked.timed_out_title",
        descriptionKey: "commands.shared.send_blocked.timed_out_description",
        descriptionVars: { time: `<t:${Math.floor(block.until / 1000)}:f>` },
      };
    case "recent_send_refused":
      return {
        titleKey: "commands.shared.send_blocked.send_refused_title",
        descriptionKey: "commands.shared.send_blocked.send_refused_description",
        descriptionVars: { time: `<t:${Math.floor(block.until / 1000)}:R>` },
      };
  }
}
