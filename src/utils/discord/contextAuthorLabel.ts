import type { GuildMember, Message } from "discord.js";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { loadUserRow, isBlacklisted } from "@/utils/db/repositories";
import { resolvePreferredDiscordDisplayName } from "@/utils/discord/displayName";
import { stripBridgePrefix } from "@/utils/bridges";
import { log } from "@/utils/misc/logger";

type ResolveContextAuthorLabelOptions = {
  guildId?: string | null;
  tomoriNickname?: string | null;
  personalMemoriesEnabled?: boolean;
};

async function resolveGuildMember(message: Message, guildId?: string | null): Promise<GuildMember | null> {
  if (!guildId || guildId === "DM" || !message.guild) {
    return null;
  }

  return (
    message.member ??
    message.guild.members.cache.get(message.author.id) ??
    (await message.guild.members.fetch(message.author.id).catch(() => null))
  );
}

export async function resolveContextAuthorLabel(
  message: Message,
  options: ResolveContextAuthorLabelOptions = {},
): Promise<string> {
  const guildId = options.guildId ?? message.guildId;
  const webhookName = message.webhookId ? stripBridgePrefix(message.author.username) : null;

  if (message.webhookId) {
    if (guildId && guildId !== "DM") {
      try {
        const personas = await getCachedAllPersonas(guildId);
        const matchedPersona = personas.find(
          (persona) => persona.tomori_nickname?.trim().toLowerCase() === webhookName?.trim().toLowerCase(),
        );
        if (matchedPersona?.tomori_nickname) {
          return matchedPersona.tomori_nickname;
        }
      } catch (error) {
        log.warn("Failed to resolve persona name for webhook-authored boomerang context message", error);
      }
    }

    return webhookName || message.author.username || "Unknown";
  }

  if (message.client.user && message.author.id === message.client.user.id) {
    return options.tomoriNickname?.trim() || message.author.username || "Tomori";
  }

  if (guildId && guildId !== "DM") {
    try {
      const userIsBlacklisted = await isBlacklisted(guildId, message.author.id);
      const userRow = await loadUserRow(message.author.id);
      const personalizationDisabled = options.personalMemoriesEnabled === false;

      if (!userIsBlacklisted && !personalizationDisabled && userRow?.user_nickname?.trim()) {
        return userRow.user_nickname.trim();
      }
    } catch (error) {
      log.warn("Failed to resolve DB nickname for boomerang context message author", error);
    }
  }

  const member = await resolveGuildMember(message, guildId);
  return resolvePreferredDiscordDisplayName({
    memberDisplayName: member?.displayName,
    user: message.author,
    fallback: stripBridgePrefix(message.author.username),
  });
}
