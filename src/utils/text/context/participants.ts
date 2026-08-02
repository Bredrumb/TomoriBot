import type { Client } from "discord.js";
import { getCurrentTimeWithOffset, formatUTCOffset, getTimeOfDayPhrase } from "@/utils/text/timezoneHelper";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { AssembledServerConfig, TomoriState, UserRow } from "@/types/db/schema";
import type { MentionConverter } from "./templates";
import type { PublicPersonaProfile } from "./types";
import { serializeParticipantKey, type ParticipantSeed } from "@/utils/text/participants/identity";
import { adaptLegacyParticipantSeeds } from "@/utils/text/participants/legacyAdapter";
import { hydrateParticipantProfiles } from "@/utils/text/participants/hydration";
import { renderParticipantPrompt } from "@/utils/text/participants/renderer";

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
  const timezoneOffset = params.tomoriConfig.timezone_offset ?? 0;
  const rendered = renderParticipantPrompt({
    profiles: hydrated.profiles,
    personaTaskLines: hydrated.personaTaskLines,
    isUserImpersonation: params.isUserImpersonation,
    botName: params.botName,
    isDMChannel: params.isDMChannel,
    channelName: params.channelName,
    channelId: params.channelId,
    currentTime: getCurrentTimeWithOffset(timezoneOffset),
    timezoneLabel: formatUTCOffset(timezoneOffset),
    timeOfDayPhrase: getTimeOfDayPhrase(timezoneOffset),
  });

  return {
    role: "user",
    parts: [
      {
        type: "text",
        text: await params.convertMentions(
          rendered.text,
          params.client,
          params.guildId,
          params.triggererName,
          params.botName,
          params.tomoriConfig.personal_memories_enabled,
        ),
      },
    ],
    metadataTag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
    conversationUsers: rendered.conversationUsers,
    participantTargetIndex: rendered.targetIndex,
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
