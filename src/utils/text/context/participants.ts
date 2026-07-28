import { GatewayIntentBits, type Client, type Guild, type GuildMember } from "discord.js";
import { personalMemoryRepository, serverScheduleRepository, userRepository } from "@/utils/db/repositories";
import { resolvePreferredDiscordDisplayName } from "@/utils/discord/displayName";
import { log } from "@/utils/misc/logger";
import { formatMemoryWithId } from "@/utils/memory/memoryId";
import {
  getCurrentTimeWithOffset,
  formatTimeWithOffset,
  formatUTCOffset,
  getTimeOfDayPhrase,
} from "@/utils/text/timezoneHelper";
import { ContextItemTag, type ConversationUserReference, type StructuredContextItem } from "@/types/misc/context";
import {
  PrivacyLevel,
  type AssembledServerConfig,
  type ReminderRow,
  type TomoriState,
  type UserRow,
} from "@/types/db/schema";
import { getUserPresenceDetails } from "./history";
import type { MentionConverter } from "./templates";
import type { PublicPersonaProfile } from "./types";

type UserConversationEntry = {
  userId: string;
  displayName: string;
  detailLines: string[];
  imageAppearanceTags?: string[];
  personalTimezoneOffset?: number | null;
  isBot: boolean;
  mentionAliases: string[];
  primaryAlias: string | null;
  mentionable: boolean;
  resolvableTargetId?: string;
};

const addAlias = (aliasCounts: Map<string, number>, aliases: Set<string>, value?: string | null) => {
  const alias = value?.trim();
  if (!alias || aliases.has(alias)) return;
  aliases.add(alias);
  const key = alias.toLowerCase();
  aliasCounts.set(key, (aliasCounts.get(key) ?? 0) + 1);
};

const normalizeImageAppearanceTags = (tags: string[] | null | undefined): string[] | undefined => {
  const normalizedTags = tags?.map((tag) => tag.trim()).filter((tag) => tag.length > 0) ?? [];
  return normalizedTags.length > 0 ? normalizedTags : undefined;
};

export function formatPendingReminderForContext(
  reminder: Pick<ReminderRow, "reminder_id" | "reminder_purpose" | "reminder_time" | "repetition_interval_hours">,
  timezoneOffset: number,
): string {
  const formattedTime = `${formatTimeWithOffset(new Date(reminder.reminder_time), timezoneOffset, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })} (${formatUTCOffset(timezoneOffset)})`;
  const reminderIdPrefix = typeof reminder.reminder_id === "number" ? `ID:${reminder.reminder_id} ` : "";
  const repeatText =
    typeof reminder.repetition_interval_hours === "number" && reminder.repetition_interval_hours >= 1
      ? `, repeats every ${reminder.repetition_interval_hours} hour(s)`
      : "";

  return `${reminderIdPrefix}"${reminder.reminder_purpose}" (scheduled for ${formattedTime}${repeatText})`;
}

export async function buildUsersInConversationContextItem(params: {
  client: Client;
  guildId: string;
  channelName: string;
  channelId: string;
  userList: string[];
  triggererName: string;
  botName: string;
  personaLineageId?: number;
  tomoriState: TomoriState | null;
  tomoriConfig: AssembledServerConfig;
  isDMChannel: boolean;
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
  impersonatedIdentityName: string | null;
  matrixUsers?: Map<string, string>;
  syntheticUsers?: Map<string, { displayName: string; type: "persona" | "webhook" }>;
  publicPersonaProfiles?: PublicPersonaProfile[];
  preloadedReferencedUserRows?: Map<string, UserRow>;
  referencedUserIds?: ReadonlySet<string>;
  toolPromptMacroResolver: { expand(text: string): Promise<string> };
  conversationCorpus: string | null;
  snapshot?: import("@/types/misc/context").RequestSnapshot;
  convertMentions: MentionConverter;
}): Promise<StructuredContextItem | null> {
  if (params.userList.length === 0) {
    return null;
  }

  let usersInConversationText = "[System: The following users are having a conversation:\n\n";
  usersInConversationText += params.isUserImpersonation
    ? 'To ping users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.\n\n'
    : `If ${params.botName} wants to ping any of these users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.\n\n`;

  const userEntries: UserConversationEntry[] = [];
  const conversationUsers: ConversationUserReference[] = [];
  const aliasCounts = new Map<string, number>();
  let botEntryAdded = false;

  for (const userIdToProcess of params.userList) {
    if (
      (params.client.user && userIdToProcess === params.client.user.id) ||
      (params.tomoriState?.is_alter && userIdToProcess === String(params.tomoriState.persona_id)) ||
      (params.tomoriState?.persona_id != null && userIdToProcess === `persona:${params.tomoriState.persona_id}`)
    ) {
      if (!botEntryAdded) {
        userEntries.push({
          userId: userIdToProcess,
          displayName: params.botName,
          detailLines: ["- Status: Online - Currently active and responding to messages"],
          imageAppearanceTags: !params.isUserImpersonation
            ? normalizeImageAppearanceTags(params.tomoriState?.physical_appearance_tags)
            : undefined,
          isBot: true,
          mentionAliases: [],
          primaryAlias: null,
          mentionable: false,
        });
        botEntryAdded = true;
      }
      continue;
    }

    let userRow =
      params.preloadedReferencedUserRows?.get(userIdToProcess) ??
      (await userRepository.loadByDiscordId(userIdToProcess).catch(() => null));
    if (!userRow && !params.referencedUserIds?.has(userIdToProcess)) {
      const guild = params.client.guilds.cache.get(params.guildId);
      const member = guild ? await guild.members.fetch(userIdToProcess).catch(() => null) : null;
      if (guild && member) {
        const userLanguage = guild.preferredLocale.startsWith("ja") ? "ja" : "en-US";
        const registrationDisplayName = resolvePreferredDiscordDisplayName({
          memberDisplayName: member.displayName,
          user: member.user,
        });
        userRow = await userRepository.register(userIdToProcess, registrationDisplayName, userLanguage);
      }
    }

    if (!userRow) {
      const syntheticEntry = params.syntheticUsers?.get(userIdToProcess);
      if (syntheticEntry) {
        userEntries.push({
          userId: userIdToProcess,
          displayName: syntheticEntry.displayName,
          detailLines: [],
          isBot: false,
          mentionAliases: [],
          primaryAlias: null,
          mentionable: false,
        });
        continue;
      }

      log.warn(`Skipping user ${userIdToProcess} - could not load user data`);
      continue;
    }

    const guild = params.client.guilds.cache.get(params.guildId);
    const member = guild ? await guild.members.fetch(userIdToProcess).catch(() => null) : null;
    const fallbackUser = member ? null : await params.client.users.fetch(userIdToProcess).catch(() => null);
    const serverPersonalizationEnabled = params.tomoriConfig.personal_memories_enabled ?? true;
    const isTriggererId = params.snapshot?.triggererUserRow?.user_disc_id === userRow.user_disc_id;
    const userIsBlacklisted = isTriggererId
      ? (params.snapshot?.isTriggererBlacklisted ?? false)
      : await userRepository.isBlacklisted(params.guildId, userRow.user_disc_id);
    const userPrivacyLevel = isTriggererId
      ? (params.snapshot?.triggererPrivacyLevel ?? PrivacyLevel.MINIMAL)
      : await userRepository.getPrivacyLevel(userRow.user_disc_id);

    const customNickname = userRow.user_nickname;
    const serverNickname = member?.nickname;
    const username = member?.user.username ?? fallbackUser?.username ?? null;
    const globalName = member?.user.globalName ?? fallbackUser?.globalName ?? null;
    const canUseCustomNickname =
      customNickname && serverPersonalizationEnabled && !userIsBlacklisted && userPrivacyLevel !== PrivacyLevel.FULL;
    const shouldIncludeCustomNicknameAlias =
      customNickname && serverPersonalizationEnabled && !userIsBlacklisted && (!serverNickname || canUseCustomNickname);

    let displayName = canUseCustomNickname
      ? customNickname
      : serverNickname
        ? serverNickname
        : `<@${userRow.user_disc_id}>`;
    if (
      params.isUserImpersonation &&
      userRow.user_disc_id === params.impersonatedUserId &&
      params.impersonatedIdentityName
    ) {
      displayName = params.impersonatedIdentityName;
    }

    const detailLines = await buildUserDetailLines({
      ...params,
      displayName,
      userRow,
      member,
      guild,
      serverPersonalizationEnabled,
      userIsBlacklisted,
      userPrivacyLevel,
    });

    const aliasSet = new Set<string>();
    if (
      params.isUserImpersonation &&
      userRow.user_disc_id === params.impersonatedUserId &&
      params.impersonatedIdentityName
    ) {
      addAlias(aliasCounts, aliasSet, params.impersonatedIdentityName);
    }
    if (shouldIncludeCustomNicknameAlias) addAlias(aliasCounts, aliasSet, customNickname);
    if (serverNickname) addAlias(aliasCounts, aliasSet, serverNickname);
    if (globalName) addAlias(aliasCounts, aliasSet, globalName);
    if (username) addAlias(aliasCounts, aliasSet, username);

    const primaryAlias =
      params.isUserImpersonation &&
      userRow.user_disc_id === params.impersonatedUserId &&
      params.impersonatedIdentityName
        ? params.impersonatedIdentityName
        : canUseCustomNickname
          ? customNickname
          : (serverNickname ?? globalName ?? username ?? userRow.user_disc_id);
    if (aliasSet.size === 0) {
      addAlias(aliasCounts, aliasSet, primaryAlias);
    }

    userEntries.push({
      userId: userRow.user_disc_id,
      displayName,
      detailLines,
      imageAppearanceTags: !params.isUserImpersonation
        ? normalizeImageAppearanceTags(userRow.physical_appearance_tags)
        : undefined,
      personalTimezoneOffset: !params.isUserImpersonation ? (userRow.timezone_offset ?? null) : undefined,
      isBot: false,
      mentionAliases: Array.from(aliasSet),
      primaryAlias,
      mentionable: true,
      resolvableTargetId: userRow.user_disc_id,
    });
  }

  appendMatrixAndSyntheticUsers(params, userEntries, aliasCounts);
  await applyPublicPersonaProfiles(params, userEntries, aliasCounts);

  usersInConversationText += renderUserEntries(userEntries, aliasCounts, conversationUsers, params.isUserImpersonation);
  usersInConversationText += await renderPendingPersonaTasks(params);
  usersInConversationText += renderChannelTimeContext(params);

  return {
    role: "user",
    parts: [
      {
        type: "text",
        text: await params.convertMentions(
          usersInConversationText.trim(),
          params.client,
          params.guildId,
          params.triggererName,
          params.botName,
          params.tomoriConfig.personal_memories_enabled,
        ),
      },
    ],
    metadataTag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
    conversationUsers,
  };
}

async function buildUserDetailLines(
  params: Parameters<typeof buildUsersInConversationContextItem>[0] & {
    displayName: string;
    userRow: NonNullable<Awaited<ReturnType<typeof userRepository.loadByDiscordId>>>;
    member: GuildMember | null;
    guild: Guild | undefined;
    serverPersonalizationEnabled: boolean;
    userIsBlacklisted: boolean;
    userPrivacyLevel: PrivacyLevel;
  },
): Promise<string[]> {
  const detailLines: string[] = [];

  if (params.userPrivacyLevel === PrivacyLevel.MINIMAL) {
    const hasPresenceIntent = params.client.options.intents?.has(GatewayIntentBits.GuildPresences);
    if (params.isDMChannel) {
      detailLines.push("- Status: Online (Direct Message)");
    } else if (hasPresenceIntent) {
      const presenceInfo =
        params.snapshot?.triggererUserRow?.user_disc_id === params.userRow.user_disc_id
          ? await getUserPresenceDetails(
              params.client,
              params.userRow.user_disc_id,
              params.guildId,
              params.snapshot?.preloadedMember,
            )
          : await getUserPresenceDetails(params.client, params.userRow.user_disc_id, params.guildId);
      detailLines.push(`- Status: ${presenceInfo}`);
    }
  }

  if (params.userPrivacyLevel === PrivacyLevel.MINIMAL && params.member) {
    const roles = params.member.roles.cache
      .filter((role) => role.id !== params.guild?.id && role.name !== "@everyone")
      .sort((a, b) => b.position - a.position)
      .map((role) => role.name);
    if (roles.length > 0) detailLines.push(`- Server Roles: ${roles.join(", ")}`);
  }

  const shouldIncludePersonalMemories =
    !params.isUserImpersonation ||
    (params.isUserImpersonation && params.userRow.user_disc_id === params.impersonatedUserId);
  if (
    shouldIncludePersonalMemories &&
    params.serverPersonalizationEnabled &&
    !params.userIsBlacklisted &&
    params.userPrivacyLevel === PrivacyLevel.MINIMAL &&
    params.userRow.user_id
  ) {
    const activeLineageId =
      params.personaLineageId ??
      params.snapshot?.tomoriState?.persona_lineage_id ??
      params.tomoriState?.persona_lineage_id ??
      0;
    const personalMemoryRows = await personalMemoryRepository.loadForUserLineage(
      params.userRow.user_id,
      activeLineageId,
      true,
    );
    const filteredPersonalRows = personalMemoryRows.filter((row) => {
      const normalized = (row.tags ?? []).map((t) => t.replace(/^["']+|["']+$/g, ""));
      const channelTags = normalized.filter((t) => t.startsWith("#"));
      const contentTags = normalized.filter((t) => !t.startsWith("#"));

      // Channel tags gate: if present and channel_memory_enabled, channel must match.
      // Channel and content filters are independent — channel match does not exempt a memory
      // from the content/corpus check below (per baetican's intended design).
      if (params.tomoriConfig.channel_memory_enabled && channelTags.length > 0) {
        const channelAllowed = channelTags.some((t) => t.slice(1).toLowerCase() === params.channelName.toLowerCase());
        if (!channelAllowed) return false;
      }

      // Content tags: if corpus filtering is active and the memory has content tags,
      // at least one must appear in the corpus. Memories with no content tags are
      // unfiltered by keyword (per /help memory-tagging: "memories without keyword
      // tags will always be active").
      if (params.conversationCorpus != null && contentTags.length > 0) {
        return contentTags.some((tag) => params.conversationCorpus?.includes(tag.toLowerCase()));
      }

      return true;
    });
    if (filteredPersonalRows.length > 0) {
      const processedMemories = await Promise.all(
        filteredPersonalRows.map(async (memoryRow, index) => {
          const processedMemory = await params.convertMentions(
            memoryRow.content,
            params.client,
            params.guildId,
            params.displayName,
            params.botName,
            params.tomoriConfig.personal_memories_enabled,
          );
          return formatMemoryWithId(memoryRow.personal_memory_id ?? index + 1, processedMemory, memoryRow.tags ?? []);
        }),
      );
      detailLines.push(`- Memories: ${processedMemories.join("; ")}`);
    }
  }

  const pendingReminders = await serverScheduleRepository.getPendingRemindersForUser(
    params.userRow.user_disc_id,
    params.guildId,
    params.tomoriState?.persona_id,
    !params.tomoriState?.is_alter,
  );
  if (pendingReminders && pendingReminders.length > 0) {
    detailLines.push("- Reminders:");
    for (const reminder of pendingReminders) {
      const timezoneOffset = params.tomoriConfig.timezone_offset ?? 0;
      detailLines.push(`  - ${formatPendingReminderForContext(reminder, timezoneOffset)}`);
    }
  }

  return detailLines;
}

async function renderPendingPersonaTasks(
  params: Parameters<typeof buildUsersInConversationContextItem>[0],
): Promise<string> {
  const botUserId = params.client.user?.id;
  const personaId = params.tomoriState?.persona_id;
  if (params.isUserImpersonation || !botUserId || typeof personaId !== "number") {
    return "";
  }

  const pendingTasks = await serverScheduleRepository.getPendingRemindersForUser(botUserId, params.guildId, personaId);
  const personaTasks = pendingTasks?.filter((reminder) => reminder.self_reminder === true) ?? [];
  if (personaTasks.length === 0) {
    return "";
  }

  const timezoneOffset = params.tomoriConfig.timezone_offset ?? 0;
  let text = "Pending Tasks Assigned to You:\n";
  for (const task of personaTasks) {
    text += `- ${formatPendingReminderForContext(task, timezoneOffset)}`;
    if (task.channel_disc_id) {
      text += ` (destination: <#${task.channel_disc_id}>)`;
    }
    text += "\n";
  }

  return `${text}\n`;
}

function appendMatrixAndSyntheticUsers(
  params: Parameters<typeof buildUsersInConversationContextItem>[0],
  userEntries: UserConversationEntry[],
  aliasCounts: Map<string, number>,
): void {
  for (const [matrixUserId, displayName] of params.matrixUsers?.entries() ?? []) {
    const aliases = new Set<string>();
    addAlias(aliasCounts, aliases, displayName);
    userEntries.push({
      userId: matrixUserId,
      displayName,
      detailLines: ["- Status: Online or status unknown"],
      isBot: false,
      mentionAliases: Array.from(aliases),
      primaryAlias: displayName || null,
      mentionable: false,
      resolvableTargetId: matrixUserId,
    });
  }
}

async function applyPublicPersonaProfiles(
  params: Parameters<typeof buildUsersInConversationContextItem>[0],
  userEntries: UserConversationEntry[],
  aliasCounts: Map<string, number>,
): Promise<void> {
  if (!params.publicPersonaProfiles || params.publicPersonaProfiles.length === 0) return;

  for (const publicPersona of params.publicPersonaProfiles) {
    const convertedAttributes: string[] = [];
    for (const attribute of publicPersona.attributes) {
      const trimmedAttribute = attribute.trim();
      if (!trimmedAttribute) continue;

      convertedAttributes.push(
        await params.convertMentions(
          await params.toolPromptMacroResolver.expand(trimmedAttribute),
          params.client,
          params.guildId,
          "User",
          publicPersona.personaName,
          params.tomoriConfig.personal_memories_enabled,
          params.snapshot,
        ),
      );
    }

    const imageAppearanceTags = params.isUserImpersonation
      ? undefined
      : normalizeImageAppearanceTags(publicPersona.imageAppearanceTags);
    if (convertedAttributes.length === 0 && !imageAppearanceTags) continue;

    const syntheticId = String(publicPersona.personaId);
    let targetEntry = userEntries.find(
      (entry) => entry.userId === syntheticId || entry.userId === `persona:${syntheticId}`,
    );

    if (!targetEntry) {
      targetEntry = userEntries.find((entry) => entry.displayName === publicPersona.personaName);
    }

    // 1. Build the header and the attribute lines separately so we can avoid
    //    re-pushing the header when appending to an entry that already has one.
    const attributeHeader = `- Known Information about ${publicPersona.personaName}:`;
    const attributeLines = convertedAttributes.map((attr) => `  - ${attr}`);

    if (targetEntry) {
      targetEntry.imageAppearanceTags = imageAppearanceTags;
      if (attributeLines.length > 0) {
        // A second persona sharing a display name may resolve to this entry via
        // the fallback. Avoid duplicating the header while retaining every line.
        if (!targetEntry.detailLines.includes(attributeHeader)) {
          targetEntry.detailLines.push(attributeHeader);
        }
        targetEntry.detailLines.push(...attributeLines);
      }
    } else {
      const aliases = new Set<string>();
      addAlias(aliasCounts, aliases, publicPersona.personaName);
      const detailLines =
        attributeLines.length > 0
          ? ["- Status: Online or status unknown", attributeHeader, ...attributeLines]
          : ["- Status: Online or status unknown"];
      userEntries.push({
        userId: `persona:${syntheticId}`,
        displayName: publicPersona.personaName,
        detailLines,
        imageAppearanceTags,
        isBot: false,
        mentionAliases: Array.from(aliases),
        primaryAlias: publicPersona.personaName,
        mentionable: false,
        resolvableTargetId: `persona:${syntheticId}`,
      });
    }
  }
}

function renderUserEntries(
  userEntries: UserConversationEntry[],
  aliasCounts: Map<string, number>,
  conversationUsers: ConversationUserReference[],
  isUserImpersonation: boolean,
): string {
  const isAliasUnique = (alias: string) => (aliasCounts.get(alias.toLowerCase()) ?? 0) === 1;
  const formatMentionHandle = (alias: string) => `@{${alias}}`;
  let text = "";

  for (const entry of userEntries) {
    if (entry.isBot) {
      text += `${entry.displayName}${isUserImpersonation ? "" : " (This is you!)"}\n`;
    } else {
      const uniqueAliases = entry.mentionAliases.filter(isAliasUnique);
      const primaryVisibleAlias =
        entry.primaryAlias && isAliasUnique(entry.primaryAlias)
          ? entry.primaryAlias
          : (uniqueAliases.find((alias) => alias !== entry.primaryAlias) ?? null);
      const aliasHandles = uniqueAliases
        .filter((alias) => alias !== primaryVisibleAlias)
        .map((alias) => formatMentionHandle(alias));
      const mentionParts: string[] = [];
      if (entry.mentionable && primaryVisibleAlias)
        mentionParts.push(`Mention: ${formatMentionHandle(primaryVisibleAlias)}`);
      if (aliasHandles.length > 0) mentionParts.push(`Aliases: ${aliasHandles.join(", ")}`);
      if (entry.mentionable && entry.mentionAliases.length > 0 && !primaryVisibleAlias) {
        mentionParts.push("Mention requires clarification");
      }
      text += `${entry.displayName}${mentionParts.length > 0 ? ` (${mentionParts.join("; ")})` : ""}\n`;
    }

    if (entry.imageAppearanceTags && entry.imageAppearanceTags.length > 0) {
      text += `- ${entry.displayName}'s Physical Appearance: ${entry.imageAppearanceTags.join(", ")}\n`;
    }
    if (entry.personalTimezoneOffset != null) {
      text += `- ${entry.displayName}'s timezone: ${formatUTCOffset(entry.personalTimezoneOffset)} (their local time: ${getCurrentTimeWithOffset(entry.personalTimezoneOffset)})\n`;
    }
    for (const line of entry.detailLines) text += `${line}\n`;
    text += "\n";

    if (entry.resolvableTargetId && entry.mentionAliases.length > 0) {
      conversationUsers.push({
        targetId: entry.resolvableTargetId,
        displayLabel: entry.displayName,
        aliases: entry.mentionAliases,
        mentionable: entry.mentionable,
      });
    }
  }

  return text;
}

function renderChannelTimeContext(params: Parameters<typeof buildUsersInConversationContextItem>[0]): string {
  const timezoneOffset = params.tomoriConfig.timezone_offset ?? 0;
  const currentTime = getCurrentTimeWithOffset(timezoneOffset);
  const timezoneLabel = formatUTCOffset(timezoneOffset);
  const timeOfDayPhrase = getTimeOfDayPhrase(timezoneOffset);
  const conversationContext = params.isDMChannel
    ? "Conversation context: Direct Message."
    : `Conversation context: #${params.channelName}${params.channelId ? ` (ID: ${params.channelId})` : ""}.`;
  return `${conversationContext}\nCurrent time: ${currentTime} (${timezoneLabel}), ${timeOfDayPhrase}.\n]`;
}
