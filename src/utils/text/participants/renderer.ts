import {
  buildParticipantTargetIndex,
  buildPurposeCollisionIndex,
  projectConversationUserReferences,
  targetAliasesForPurpose,
  type ParticipantTargetIndex,
} from "@/utils/text/participants/targetIndex";
import type { HydratedParticipantProfile, PluralKitSystemNote } from "@/utils/text/participants/hydration";
import { normalizeParticipantAlias } from "@/utils/text/participants/aliases";
import { serializeParticipantKey } from "@/utils/text/participants/identity";

export interface ParticipantPromptRenderParams {
  profiles: readonly HydratedParticipantProfile[];
  personaTaskLines: readonly string[];
  pluralKitSystems?: readonly PluralKitSystemNote[];
  isUserImpersonation: boolean;
  botName: string;
  isDMChannel: boolean;
  channelName: string;
  channelId: string;
  currentTime: string;
  timezoneLabel: string;
  timeOfDayPhrase: string;
}

export interface RenderedParticipantPrompt {
  text: string;
  targetIndex: ParticipantTargetIndex;
  conversationUsers: ReturnType<typeof projectConversationUserReferences>;
}

export function renderParticipantPrompt(params: ParticipantPromptRenderParams): RenderedParticipantPrompt {
  const targetIndex = buildParticipantTargetIndex(params.profiles);
  let text = "[System: The following users are having a conversation:\n\n";
  text += params.isUserImpersonation
    ? 'To ping users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.\n\n'
    : `If ${params.botName} wants to ping any of these users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.\n\n`;
  text += renderProfileEntries(params.profiles, targetIndex, params.isUserImpersonation);
  text += renderPluralKitSystemNotes(params.pluralKitSystems ?? []);
  if (params.personaTaskLines.length > 0) text += `${params.personaTaskLines.join("\n")}\n\n`;
  text += renderChannelTimeFooter(params);
  return {
    text: text.trim(),
    targetIndex,
    conversationUsers: projectConversationUserReferences(targetIndex),
  };
}

/**
 * Systems render as their own section rather than as a heading their members sit
 * under: nesting members below a system makes the system the entity and its
 * members its parts, and grouping would reorder speakers away from first-seen
 * order.
 *
 * The host account is named here rather than on each member's identity line
 * because it is a property of the system. It stays appositive: any relational
 * verb ("owned by", "run by") reads as authority over the system, and the host
 * label is usually a member's or the system's own name, so it would invent a
 * hierarchy among system-mates that a model then routes around the speaker.
 * A system therefore renders whenever it is present, description or not.
 */
function renderPluralKitSystemNotes(systems: readonly PluralKitSystemNote[]): string {
  if (systems.length === 0) return "";
  const entries = systems
    .map((system) => {
      const label = `${system.label.charAt(0).toUpperCase()}${system.label.slice(1)}`;
      const hosts = system.hostLabels.length > 0 ? ` (shared account: ${system.hostLabels.join("; ")})` : "";
      return `- ${label}${hosts}${system.description ? `: ${system.description}` : ""}`;
    })
    .join("\n");
  return `Some of the people above are members of plural systems:\n${entries}\n\n`;
}

function renderProfileEntries(
  profiles: readonly HydratedParticipantProfile[],
  targetIndex: ParticipantTargetIndex,
  isUserImpersonation: boolean,
): string {
  const outputCollisions = buildPurposeCollisionIndex(targetIndex, "output_mention");
  const formatMentionHandle = (alias: string) => `@{${alias}}`;
  let text = "";

  for (const profile of profiles) {
    if (profile.isBot) {
      text += `${profile.displayName}${isUserImpersonation ? "" : " (This is you!)"}\n`;
    } else {
      const target = targetIndex.targets.find(
        (candidate) => candidate.serializedKey === serializeParticipantKey(profile.key),
      );
      const targetOutputAliases = target
        ? targetAliasesForPurpose(target, "output_mention")
            .filter((alias) => alias.exposure === "visible")
            .map((alias) => alias.value)
        : [];
      const outputAliases = profile.mentionable || profile.primaryAlias ? targetOutputAliases : [];
      const isAliasUnique = (alias: string) => {
        const normalized = normalizeParticipantAlias(alias);
        return normalized ? (outputCollisions.get(normalized)?.length ?? 0) === 1 : false;
      };
      const uniqueAliases = outputAliases.filter(isAliasUnique);
      const primaryVisibleAlias =
        profile.primaryAlias && isAliasUnique(profile.primaryAlias)
          ? profile.primaryAlias
          : (uniqueAliases.find((alias) => alias !== profile.primaryAlias) ?? null);
      const aliasHandles = uniqueAliases
        .filter((alias) => alias !== primaryVisibleAlias)
        .map((alias) => formatMentionHandle(alias));
      const mentionParts: string[] = [];
      if (profile.mentionable && primaryVisibleAlias) {
        mentionParts.push(`Mention: ${formatMentionHandle(primaryVisibleAlias)}`);
      }
      if (aliasHandles.length > 0) mentionParts.push(`Aliases: ${aliasHandles.join(", ")}`);
      if (profile.mentionable && outputAliases.length > 0 && !primaryVisibleAlias) {
        mentionParts.push("Mention requires clarification");
      }
      text += `${profile.displayName}${mentionParts.length > 0 ? ` (${mentionParts.join("; ")})` : ""}\n`;
    }

    for (const profileField of [...profile.fields].sort((left, right) => left.order - right.order)) {
      if (!profileField.visibility.visible) continue;
      for (const line of profileField.lines) text += `${line}\n`;
    }
    text += "\n";
  }

  return text;
}

function renderChannelTimeFooter(params: ParticipantPromptRenderParams): string {
  const conversationContext = params.isDMChannel
    ? "Conversation context: Direct Message."
    : `Conversation context: #${params.channelName}${params.channelId ? ` (ID: ${params.channelId})` : ""}.`;
  return `${conversationContext}\nCurrent time: ${params.currentTime} (${params.timezoneLabel}), ${params.timeOfDayPhrase}.\n]`;
}
