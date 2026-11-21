import type { Client, GuildTextBasedChannel } from "discord.js";
import { PrivacyLevel } from "@/types/db/schema";
import type { RequestSnapshot } from "@/types/misc/context";
import { personaRepository } from "@/utils/db/repositories";
import { userNamingRepository, userPersonaNamingPairKey } from "@/utils/db/repositories/UserNamingRepository";
import { getCachedBlacklistStatus, getCachedPrivacyLevel, getCachedUserRow } from "@/utils/cache/userCache";
import { fetchParticipantMember, type ParticipantRequestScope } from "@/utils/text/participants/preparation";
import { formatChannelReferenceLabel } from "@/utils/discord/targetResolver";
import { log } from "@/utils/misc/logger";
import { normalizeCustomEmojisForLlm, replaceTemplateVariables } from "@/utils/text/processors/mentionProcessor";

export type MentionMemo = Map<string, Promise<string | null>>;
const DISCORD_CHANNEL_LINK_TEST_PATTERN =
  /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{17,19})\/\d{17,19}(?:\/\d{17,19})?/i;
const DISCORD_CHANNEL_LINK_REPLACE_PATTERN =
  /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{17,19})\/(\d{17,19})(?:\/(\d{17,19}))?/gi;
export const USER_REFERENCE_MACRO_PATTERN = /(?<!\{)\{@(\d{17,20})\}(?!\})/g;
const MENTION_PATTERN = /<[@#][!&]?(\d{17,19})>/g;
const TEMPLATE_MENTION_PATTERN = new RegExp(`${MENTION_PATTERN.source}|${USER_REFERENCE_MACRO_PATTERN.source}`, "g");

// "resolve" is for bot-authored templates; "preserve" is for raw messages because expanding model lines collapses
// both macros onto the persona name.
export type IdentityMacroMode = "resolve" | "preserve" | "template";

function needsConversion(text: string, identityMacroMode: IdentityMacroMode): boolean {
  return (
    /<[@#][!&]?\d{17,19}>/.test(text) ||
    DISCORD_CHANNEL_LINK_TEST_PATTERN.test(text) ||
    (identityMacroMode === "template" && text.search(USER_REFERENCE_MACRO_PATTERN) !== -1) ||
    (identityMacroMode !== "preserve" &&
      /(?:\{\{(?:bot|char|user|user_formatted|user_term)\}\}|\{(?:bot|char|user|user_formatted|user_term)\})/i.test(
        text,
      ))
  );
}

function normalizeDiscordChannelLinks(text: string): string {
  return text.replace(DISCORD_CHANNEL_LINK_REPLACE_PATTERN, (_match, channelId: string) => `<#${channelId}>`);
}

async function resolveUserReference(
  id: string,
  client: Client,
  serverId: string,
  personalMemoriesEnabled: boolean | undefined,
  personaLineageId: number | undefined,
): Promise<string | null> {
  if (personalMemoriesEnabled !== false) {
    const userRow = await getCachedUserRow(id);
    if (
      userRow &&
      (await getCachedPrivacyLevel(id)) !== PrivacyLevel.FULL &&
      !(await getCachedBlacklistStatus(serverId, id))
    ) {
      if (userRow.user_id && personaLineageId !== undefined && personaLineageId >= 0) {
        try {
          const preferences = await userNamingRepository.loadPreferences([
            { userId: userRow.user_id, personaLineageId },
          ]);
          const nickname = preferences.get(
            userPersonaNamingPairKey(userRow.user_id, personaLineageId),
          )?.nickname_override;
          if (nickname?.trim()) return nickname.trim();
        } catch (error) {
          log.warn("Could not load persona nickname for a prompt macro", error);
        }
      }
      const globalNickname = userRow.user_nickname?.trim();
      if (globalNickname) return globalNickname;
    }
  }

  const cachedUser = client.users.cache.get(id) ?? client.guilds.cache.get(serverId)?.members.cache.get(id)?.user;
  const user = cachedUser ?? (await client.users.fetch(id).catch(() => null));
  return user?.username ?? null;
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

export async function convertMentions(
  text: string,
  client: Client,
  serverId: string,
  triggererName?: string,
  tomoriNickname?: string,
  personalMemoriesEnabled?: boolean,
  snapshot?: RequestSnapshot,
  identityMacroMode: IdentityMacroMode = "resolve",
  identityValues?: { userFormatted?: string; userTerm?: string },
  mentionMemo: MentionMemo = new Map(),
  requestScope?: ParticipantRequestScope,
  personaLineageId: number | undefined = snapshot?.tomoriState?.persona_lineage_id,
): Promise<string> {
  const normalizedText = normalizeDiscordChannelLinks(text);
  if (!needsConversion(text, identityMacroMode)) {
    return normalizedText;
  }

  let currentTomoriNickname = tomoriNickname;
  if (!currentTomoriNickname) {
    const tomoriState = snapshot?.tomoriState ?? (await personaRepository.loadState(serverId));
    currentTomoriNickname = tomoriState?.persona_nickname || process.env.DEFAULT_BOTNAME || "Tomori";
  }

  const matches = Array.from(
    normalizedText.matchAll(identityMacroMode === "template" ? TEMPLATE_MENTION_PATTERN : MENTION_PATTERN),
  );
  let result = normalizedText;

  if (matches.length > 0) {
    const mentionsData = matches.map((match) => ({
      match: match[0],
      id: match[1] ?? match[2],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }));

    const replacements = await Promise.all(
      mentionsData.map(async ({ match, id }) => {
        if (match.startsWith("{@")) {
          const key = `macro:${serverId}:${personaLineageId}:${personalMemoriesEnabled !== false}:${id}`;
          let resolution = mentionMemo.get(key);
          if (!resolution) {
            resolution = resolveUserReference(id, client, serverId, personalMemoriesEnabled, personaLineageId);
            mentionMemo.set(key, resolution);
          }
          return (await resolution) ?? match;
        }

        if (match.startsWith("<@")) {
          const key = `${serverId}:${id}`;
          let resolution = mentionMemo.get(key);
          if (!resolution) {
            resolution = (async () => {
              try {
                if (client.user && id === client.user.id && currentTomoriNickname) {
                  const guild = serverId === "DM" ? null : client.guilds.cache.get(serverId);
                  const member = guild ? await fetchParticipantMember(guild, id, requestScope) : null;
                  const displayName = member?.displayName?.trim() || currentTomoriNickname;
                  return `${displayName}`;
                }

                const isTriggererId = snapshot?.triggererUserRow?.user_disc_id === id;
                const isUserBlacklisted = isTriggererId
                  ? (snapshot?.isTriggererBlacklisted ?? false)
                  : await getCachedBlacklistStatus(serverId, id);
                const userData = isTriggererId ? snapshot?.triggererUserRow : await getCachedUserRow(id);
                const serverPersonalizationDisabled = personalMemoriesEnabled === false;

                if (!isUserBlacklisted && !serverPersonalizationDisabled && userData?.user_nickname) {
                  return `${userData.user_nickname}`;
                }

                const guild = serverId === "DM" ? null : client.guilds.cache.get(serverId);
                const member = guild ? await fetchParticipantMember(guild, id, requestScope) : null;
                const serverNickname = member?.nickname ?? null;

                if (serverNickname) {
                  return `${serverNickname}`;
                }

                const username = member?.user.username ?? null;
                if (username) {
                  return `${username}`;
                }

                const user = client.users.cache.get(id) || (await client.users.fetch(id).catch(() => null));
                if (user) {
                  return `${user.username}`;
                }
              } catch (error) {
                log.error(`Error resolving nickname for user ${id} in convertMentions:`, error, {
                  errorType: "MentionResolutionError",
                  metadata: { userIdToResolve: id, guildDiscordId: serverId },
                });
              }
              log.warn(`Could not resolve user mention: ${match}`);
              return null;
            })();
            mentionMemo.set(key, resolution);
          }
          return (await resolution) ?? match;
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

  if (identityMacroMode !== "preserve") {
    result = replaceTemplateVariables(result, {
      bot: currentTomoriNickname,
      user: triggererName || "User",
      user_formatted: identityValues?.userFormatted,
      user_term: identityValues?.userTerm,
    });
  }

  return result;
}

export { normalizeCustomEmojisForLlm };
