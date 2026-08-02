import type { Client } from "discord.js";
import { getCurrentTimeWithOffset, formatUTCOffset, getTimeOfDayPhrase } from "@/utils/text/timezoneHelper";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { AssembledServerConfig, TomoriState, UserRow } from "@/types/db/schema";
import type { MentionConverter } from "./templates";
import type { PublicPersonaProfile } from "./types";
import { serializeParticipantKey, type ParticipantSeed } from "@/utils/text/participants/identity";
import { hydrateParticipantProfiles } from "@/utils/text/participants/hydration";
import { renderParticipantPrompt } from "@/utils/text/participants/renderer";
import type { ParticipantPreparationDiagnostics } from "@/utils/text/participants/preparation";
import type { ParticipantProfileEnricherRegistry } from "@/utils/text/participants/profileEnrichers";
import { log } from "@/utils/misc/logger";

export { formatPendingReminderForContext } from "@/utils/text/participants/hydration";

export async function buildParticipantContextItem(params: {
  client: Client;
  guildId: string;
  channelName: string;
  channelId: string;
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
  matrixUsers?: ReadonlyMap<string, string>;
  syntheticUsers?: ReadonlyMap<string, { displayName: string; type: "persona" | "webhook" }>;
  publicPersonaProfiles?: readonly PublicPersonaProfile[];
  preloadedReferencedUserRows?: ReadonlyMap<string, UserRow>;
  referencedUserIds?: ReadonlySet<string>;
  toolPromptMacroResolver: { expand(text: string): Promise<string> };
  conversationCorpus: string | null;
  snapshot?: import("@/types/misc/context").RequestSnapshot;
  convertMentions: MentionConverter;
  preparationDiagnostics?: ParticipantPreparationDiagnostics;
  profileEnricherRegistry?: ParticipantProfileEnricherRegistry;
}): Promise<StructuredContextItem | null> {
  const typedKeys = new Set<string>();
  for (const seed of params.participantSeeds) {
    const serializedKey = serializeParticipantKey(seed.key);
    if (typedKeys.has(serializedKey)) {
      throw new Error(`Prepared participant seeds contain duplicate identity ${serializedKey}`);
    }
    typedKeys.add(serializedKey);
  }
  if (params.participantSeeds.length === 0) {
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
    profileEnricherRegistry: params.profileEnricherRegistry,
  });
  const timezoneOffset = params.tomoriConfig.timezone_offset ?? 0;
  const renderStartedAt = performance.now();
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
  const renderDurationMs = performance.now() - renderStartedAt;
  emitParticipantPreparationMetric(params.preparationDiagnostics, hydrated.diagnostics, renderDurationMs);

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

function emitParticipantPreparationMetric(
  preparation: ParticipantPreparationDiagnostics | undefined,
  hydration: Awaited<ReturnType<typeof hydrateParticipantProfiles>>["diagnostics"],
  renderDurationMs: number,
): void {
  const rejectionCounts = preparation?.rejectionCounts;
  const sourceContributions = preparation?.sourceContributions ?? [];
  const enricherContributions = hydration.enricherContributions;
  log.metric("participant_context_preparation", {
    candidate_count: preparation?.candidateCount ?? 0,
    included_count: preparation?.includedCount ?? 0,
    hydrated_participant_count: hydration.profileCount,
    discovery_cache_hit: preparation?.discoveryCacheHit ? 1 : 0,
    discovery_duration_ms: Number((preparation?.discoveryDurationMs ?? 0).toFixed(3)),
    hydration_duration_ms: Number(hydration.durationMs.toFixed(3)),
    render_duration_ms: Number(renderDurationMs.toFixed(3)),
    rejected_ineligible_state: rejectionCounts?.ineligible_state ?? 0,
    rejected_bot: rejectionCounts?.bot ?? 0,
    rejected_non_member: rejectionCounts?.non_member ?? 0,
    rejected_ambiguous_alias: rejectionCounts?.ambiguous_alias ?? 0,
    rejected_existing_participant: rejectionCounts?.existing_participant ?? 0,
    rejected_blocked_source: rejectionCounts?.blocked_source ?? 0,
    rejected_missing_guild: rejectionCounts?.missing_guild ?? 0,
    candidate_source_reads: preparation?.externalCalls.candidateSourceReads ?? 0,
    member_cache_hits: preparation?.externalCalls.memberCacheHits ?? 0,
    member_fetches: preparation?.externalCalls.memberFetches ?? 0,
    source_contribution_successes: sourceContributions.filter((item) => item.status === "success").length,
    source_contribution_failures: sourceContributions.filter((item) => item.status === "failed").length,
    source_contribution_timeouts: sourceContributions.filter((item) => item.status === "timed_out").length,
    source_contribution_duration_ms: Number(
      sourceContributions.reduce((total, item) => total + item.durationMs, 0).toFixed(3),
    ),
    enricher_contribution_successes: enricherContributions.filter((item) => item.status === "success").length,
    enricher_contribution_failures: enricherContributions.filter((item) => item.status === "failed").length,
    enricher_contribution_timeouts: enricherContributions.filter((item) => item.status === "timed_out").length,
    enricher_contribution_duration_ms: Number(
      enricherContributions.reduce((total, item) => total + item.durationMs, 0).toFixed(3),
    ),
    user_row_reads: hydration.externalCalls.userRowLoads,
    registration_calls: hydration.externalCalls.registrations,
    blacklist_reads: hydration.externalCalls.blacklistReads,
    privacy_reads: hydration.externalCalls.privacyReads,
    personal_memory_reads: hydration.externalCalls.personalMemoryReads,
    reminder_reads: hydration.externalCalls.reminderReads,
    hydration_member_reads: hydration.externalCalls.memberReads,
    fallback_user_reads: hydration.externalCalls.fallbackUserReads,
    presence_reads: hydration.externalCalls.presenceReads,
  });
}
