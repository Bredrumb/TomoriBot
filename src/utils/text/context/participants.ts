import type { Client } from "discord.js";
import { getCurrentTimeWithOffset, formatUTCOffset, getTimeOfDayPhrase } from "@/utils/text/timezoneHelper";
import { ContextItemTag, type ConversationUserReference, type StructuredContextItem } from "@/types/misc/context";
import type { AssembledServerConfig, TomoriState, UserRow } from "@/types/db/schema";
import type { MentionConverter } from "./templates";
import type { PublicPersonaProfile } from "./types";
import {
  aliasesForPurpose,
  buildAliasCollisionIndex,
  normalizeParticipantAlias,
} from "@/utils/text/participants/aliases";
import { serializeParticipantKey, type ParticipantSeed } from "@/utils/text/participants/identity";
import { adaptLegacyParticipantSeeds } from "@/utils/text/participants/legacyAdapter";
import { hydrateParticipantProfiles, type HydratedParticipantProfile } from "@/utils/text/participants/hydration";

export { formatPendingReminderForContext } from "@/utils/text/participants/hydration";

export async function buildParticipantContextItem(params: {
  client: Client;
  guildId: string;
  channelName: string;
  channelId: string;
  userList: string[];
  participantSeeds: readonly ParticipantSeed[];
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
  const typedKeys = new Set<string>();
  for (const seed of params.participantSeeds) {
    const serializedKey = serializeParticipantKey(seed.key);
    if (typedKeys.has(serializedKey)) {
      throw new Error(`Prepared participant seeds contain duplicate identity ${serializedKey}`);
    }
    typedKeys.add(serializedKey);
  }
  if (params.userList.length > 0 && params.participantSeeds.length === 0) {
    throw new Error("Prepared participant seeds cannot be empty when legacy participants are present");
  }

  if (params.userList.length === 0) {
    return null;
  }

  let usersInConversationText = "[System: The following users are having a conversation:\n\n";
  usersInConversationText += params.isUserImpersonation
    ? 'To ping users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.\n\n'
    : `If ${params.botName} wants to ping any of these users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.\n\n`;

  const conversationUsers: ConversationUserReference[] = [];
  const hydrated = await hydrateParticipantProfiles({
    client: params.client,
    guildId: params.guildId,
    channelName: params.channelName,
    participantSeeds: params.participantSeeds,
    activePersonaScope: {
      personaId: params.tomoriState?.persona_id,
      lineageId:
        params.personaLineageId ??
        params.snapshot?.tomoriState?.persona_lineage_id ??
        params.tomoriState?.persona_lineage_id,
      isMainPersona: !params.tomoriState?.is_alter,
      isUserImpersonation: params.isUserImpersonation,
      impersonatedUserId: params.impersonatedUserId,
    },
    tomoriState: params.tomoriState,
    tomoriConfig: params.tomoriConfig,
    isDMChannel: params.isDMChannel,
    impersonatedIdentityName: params.impersonatedIdentityName,
    matrixUsers: params.matrixUsers,
    syntheticUsers: params.syntheticUsers,
    publicPersonaProfiles: params.publicPersonaProfiles,
    preloadedReferencedUserRows: params.preloadedReferencedUserRows,
    referencedUserIds: params.referencedUserIds,
    toolPromptMacroResolver: params.toolPromptMacroResolver,
    conversationCorpus: params.conversationCorpus,
    snapshot: params.snapshot,
    convertMentions: params.convertMentions,
    botName: params.botName,
  });

  usersInConversationText += renderUserEntries(hydrated.profiles, conversationUsers, params.isUserImpersonation);
  if (hydrated.personaTaskLines.length > 0) {
    usersInConversationText += `${hydrated.personaTaskLines.join("\n")}\n\n`;
  }
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

export async function buildUsersInConversationContextItem(
  params: Omit<Parameters<typeof buildParticipantContextItem>[0], "participantSeeds">,
): Promise<StructuredContextItem | null> {
  return buildParticipantContextItem({
    ...params,
    participantSeeds: adaptLegacyParticipantSeeds({
      userList: params.userList,
      clientUserId: params.client.user?.id,
      activePersonaId: params.tomoriState?.persona_id,
      activePersonaIsAlter: params.tomoriState?.is_alter,
      syntheticUsers: params.syntheticUsers,
      matrixUsers: params.matrixUsers,
      publicPersonaProfiles: params.publicPersonaProfiles,
    }),
  });
}

function renderUserEntries(
  userEntries: readonly HydratedParticipantProfile[],
  conversationUsers: ConversationUserReference[],
  isUserImpersonation: boolean,
): string {
  const outputCollisionIndex = buildAliasCollisionIndex(
    userEntries.flatMap((entry) => entry.aliases),
    "output_mention",
  );
  const isAliasUnique = (alias: string) =>
    (outputCollisionIndex.get(normalizeParticipantAlias(alias))?.owners.length ?? 0) === 1;
  const formatMentionHandle = (alias: string) => `@{${alias}}`;
  let text = "";

  for (const entry of userEntries) {
    if (entry.isBot) {
      text += `${entry.displayName}${isUserImpersonation ? "" : " (This is you!)"}\n`;
    } else {
      const outputAliases = aliasesForPurpose(entry.aliases, "output_mention").map((alias) => alias.value);
      const uniqueAliases = outputAliases.filter(isAliasUnique);
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
      if (entry.mentionable && outputAliases.length > 0 && !primaryVisibleAlias) {
        mentionParts.push("Mention requires clarification");
      }
      text += `${entry.displayName}${mentionParts.length > 0 ? ` (${mentionParts.join("; ")})` : ""}\n`;
    }

    for (const profileField of [...entry.fields].sort((left, right) => left.order - right.order)) {
      if (!profileField.visibility.visible) continue;
      for (const line of profileField.lines) text += `${line}\n`;
    }
    text += "\n";

    const toolAliases = aliasesForPurpose(entry.aliases, "tool_target").map((alias) => alias.value);
    if (entry.resolvableTargetId && toolAliases.length > 0) {
      conversationUsers.push({
        targetId: entry.resolvableTargetId,
        displayLabel: entry.displayName,
        aliases: toolAliases,
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
