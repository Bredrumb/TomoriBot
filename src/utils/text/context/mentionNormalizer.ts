import type { Client, GuildTextBasedChannel } from "discord.js";
import { loadTomoriState, loadUserRow, isBlacklisted } from "@/utils/db/repositories";
import { formatChannelReferenceLabel } from "@/utils/discord/targetResolver";
import { log } from "@/utils/misc/logger";
import { normalizeCustomEmojisForLlm, replaceTemplateVariables } from "@/utils/text/processors/mentionProcessor";

const mentionCache = new Map<string, string>();
const DISCORD_CHANNEL_LINK_TEST_PATTERN =
  /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{17,19})\/\d{17,19}(?:\/\d{17,19})?/i;
const DISCORD_CHANNEL_LINK_REPLACE_PATTERN =
  /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{17,19})\/(\d{17,19})(?:\/(\d{17,19}))?/gi;

function needsConversion(text: string): boolean {
  return (
    /<[@#][!&]?\d{17,19}>/.test(text) ||
    DISCORD_CHANNEL_LINK_TEST_PATTERN.test(text) ||
    /(?:\{\{(?:bot|char|user)\}\}|\{(?:bot|char|user)\})/i.test(text)
  );
}

function normalizeDiscordChannelLinks(text: string): string {
  return text.replace(DISCORD_CHANNEL_LINK_REPLACE_PATTERN, (_match, channelId: string) => `<#${channelId}>`);
}

export function splitLeadingSystemBlocks(content: string): {
  leadingSystemBlocks: string[];
  remainingContent: string | null;
} {
  const lines = content.split("\n");
  const leadingSystemBlocks: string[] = [];
  let currentIndex = 0;

  while (currentIndex < lines.length && /^\[System: .*]$/.test(lines[currentIndex])) {
    leadingSystemBlocks.push(lines[currentIndex]);
    currentIndex++;
  }

  const remainingContent = lines.slice(currentIndex).join("\n").trim();
  return {
    leadingSystemBlocks,
    remainingContent: remainingContent || null,
  };
}

/**
 * Converts Discord mentions, channel links, roles, and `{user}`/`{bot}` placeholders into LLM-safe labels.
 */
export async function convertMentions(
  text: string,
  client: Client,
  serverId: string,
  triggererName?: string,
  tomoriNickname?: string,
  personalMemoriesEnabled?: boolean,
  snapshot?: import("@/types/misc/context").RequestSnapshot,
): Promise<string> {
  const normalizedText = normalizeDiscordChannelLinks(text);
  if (!needsConversion(text)) {
    return normalizedText;
  }

  mentionCache.clear();

  let currentTomoriNickname = tomoriNickname;
  if (!currentTomoriNickname) {
    const tomoriState = snapshot?.tomoriState ?? (await loadTomoriState(serverId));
    currentTomoriNickname = tomoriState?.tomori_nickname || process.env.DEFAULT_BOTNAME || "Tomori";
  }

  const mentionPattern = /<[@#][!&]?(\d{17,19})>/g;
  const matches = Array.from(normalizedText.matchAll(mentionPattern));
  let result = normalizedText;

  if (matches.length > 0) {
    const mentionsData = matches.map((match) => ({
      match: match[0],
      id: match[1],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }));

    const replacements = await Promise.all(
      mentionsData.map(async ({ match, id }) => {
        if (match.startsWith("<@")) {
          const cachedName = mentionCache.get(id);
          if (cachedName) return `${cachedName}`;
          try {
            if (client.user && id === client.user.id && currentTomoriNickname) {
              const guild = serverId === "DM" ? null : client.guilds.cache.get(serverId);
              const member = guild
                ? (guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null)))
                : null;
              const displayName = member?.displayName?.trim() || currentTomoriNickname;
              mentionCache.set(id, displayName);
              return `${displayName}`;
            }

            const isTriggererId = snapshot?.triggererUserRow?.user_disc_id === id;
            const isUserBlacklisted = isTriggererId
              ? (snapshot?.isTriggererBlacklisted ?? false)
              : await isBlacklisted(serverId, id);
            const userData = isTriggererId ? snapshot?.triggererUserRow : await loadUserRow(id);
            const serverPersonalizationDisabled = personalMemoriesEnabled === false;

            if (!isUserBlacklisted && !serverPersonalizationDisabled && userData?.user_nickname) {
              mentionCache.set(id, userData.user_nickname);
              return `${userData.user_nickname}`;
            }

            const guild = serverId === "DM" ? null : client.guilds.cache.get(serverId);
            const member = guild
              ? (guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null)))
              : null;
            const serverNickname = member?.nickname ?? null;

            if (serverNickname) {
              mentionCache.set(id, serverNickname);
              return `${serverNickname}`;
            }

            const username = member?.user.username ?? null;
            if (username) {
              mentionCache.set(id, username);
              return `${username}`;
            }

            const user = client.users.cache.get(id) || (await client.users.fetch(id).catch(() => null));
            if (user) {
              mentionCache.set(id, user.username);
              return `${user.username}`;
            }
          } catch (error) {
            log.error(`Error resolving nickname for user ${id} in convertMentions:`, error, {
              errorType: "MentionResolutionError",
              metadata: { userIdToResolve: id, guildDiscordId: serverId },
            });
          }
          log.warn(`Could not resolve user mention: ${match}`);
          return match;
        }

        if (match.startsWith("<#")) {
          try {
            const guild = client.guilds.cache.get(serverId);
            const channel = guild?.channels.cache.get(id) || (await client.channels.fetch(id).catch(() => null));
            if (channel?.isTextBased() && !channel.isDMBased()) {
              return await formatChannelReferenceLabel(channel as GuildTextBasedChannel);
            }
          } catch (error) {
            log.error(`Error resolving channel mention ${id} in convertMentions:`, error, {
              errorType: "MentionResolutionError",
              metadata: { channelIdToResolve: id, guildDiscordId: serverId },
            });
          }
          log.warn(`Could not resolve channel mention: ${match}`);
          return match;
        }

        if (match.startsWith("<@&")) {
          try {
            const guild = client.guilds.cache.get(serverId);
            const role = guild?.roles.cache.get(id) || (await guild?.roles.fetch(id).catch(() => null));
            if (role) {
              return `@${role.name}`;
            }
          } catch (error) {
            log.error(`Error resolving role mention ${id} in convertMentions:`, error, {
              errorType: "MentionResolutionError",
              metadata: { roleIdToResolve: id, guildDiscordId: serverId },
            });
          }
          log.warn(`Could not resolve role mention: ${match}`);
          return match;
        }
        return match;
      }),
    );

    for (let i = mentionsData.length - 1; i >= 0; i--) {
      const { start, end } = mentionsData[i];
      if (
        typeof start === "number" &&
        typeof end === "number" &&
        start < end &&
        start < result.length &&
        end <= result.length
      ) {
        result = result.substring(0, start) + replacements[i] + result.substring(end);
      } else {
        log.warn(`Invalid mention indices for replacement: start=${start}, end=${end}, match=${mentionsData[i].match}`);
      }
    }
  }

  result = replaceTemplateVariables(result, {
    bot: currentTomoriNickname,
    user: triggererName || "User",
  });

  return result;
}

export { normalizeCustomEmojisForLlm };
