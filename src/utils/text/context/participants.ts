import type { Client } from "discord.js";
import { getCurrentTimeWithOffset, formatUTCOffset, getTimeOfDayPhrase } from "@/utils/text/timezoneHelper";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { AssembledServerConfig, TomoriState, UserRow } from "@/types/db/schema";
import type { MentionConverter } from "./templates";
import type { PublicPersonaProfile } from "./types";
import { serializeParticipantKey, type ParticipantSeed } from "@/utils/text/participants/identity";
import { hydrateParticipantProfiles } from "@/utils/text/participants/hydration";
import { renderParticipantPrompt } from "@/utils/text/participants/renderer";
import type { ParticipantProfileEnricherRegistry } from "@/utils/text/participants/profileEnrichers";

export { formatPendingReminderForContext } from "@/utils/text/participants/hydration";

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

function formatMinuteOfDay(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export function formatPendingReminderForContext(
  reminder: Pick<
    ReminderRow,
    | "reminder_id"
    | "reminder_purpose"
    | "reminder_time"
    | "repetition_interval_hours"
    | "repetition_interval_minutes"
    | "repeat_remaining_count"
    | "repeat_until_time"
    | "daily_window_start_minutes"
    | "daily_window_end_minutes"
    | "daily_window_timezone_offset"
  >,
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
  const repeatMinutes =
    typeof reminder.repetition_interval_minutes === "number" && reminder.repetition_interval_minutes >= 1
      ? reminder.repetition_interval_minutes
      : typeof reminder.repetition_interval_hours === "number" && reminder.repetition_interval_hours >= 1
        ? reminder.repetition_interval_hours * 60
        : 0;
  const repeatDetails: string[] = [];

  if (repeatMinutes >= 1) {
    repeatDetails.push(
      repeatMinutes % 60 === 0
        ? `repeats every ${repeatMinutes / 60} hour(s)`
        : `repeats every ${repeatMinutes} minute(s)`,
    );

    if (typeof reminder.repeat_remaining_count === "number" && reminder.repeat_remaining_count >= 1) {
      repeatDetails.push(`${reminder.repeat_remaining_count} remaining run(s)`);
    }

    if (reminder.repeat_until_time instanceof Date) {
      const formattedRepeatUntil = `${formatTimeWithOffset(new Date(reminder.repeat_until_time), timezoneOffset, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })} (${formatUTCOffset(timezoneOffset)})`;
      repeatDetails.push(`until ${formattedRepeatUntil}`);
    }

    if (
      typeof reminder.daily_window_start_minutes === "number" &&
      typeof reminder.daily_window_end_minutes === "number" &&
      typeof reminder.daily_window_timezone_offset === "number"
    ) {
      repeatDetails.push(
        `active ${formatMinuteOfDay(reminder.daily_window_start_minutes)}-${formatMinuteOfDay(reminder.daily_window_end_minutes)} (${formatUTCOffset(reminder.daily_window_timezone_offset)})`,
      );
    }
  }

  const repeatText = repeatDetails.length > 0 ? `, ${repeatDetails.join(", ")}` : "";

  return `${reminderIdPrefix}"${reminder.reminder_purpose}" (scheduled for ${formattedTime}${repeatText})`;
}

export async function buildUsersInConversationContextItem(params: {
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
