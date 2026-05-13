import type { Client } from "discord.js";
import { ContextItemTag, type ContextPart, type StructuredContextItem } from "@/types/misc/context";
import type { ConditioningType } from "@/types/db/schema";
import { loadConditioningGroupsForPersona } from "@/utils/db/conditioningDb";
import {
  CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE,
  getConditioningContextPastParticiple,
} from "@/utils/conditioning/conditioning";

export const DEFAULT_SYSTEM_PROMPT =
  "\n{bot} makes sure to respond short and concisely, as {bot} is aware that no one really likes to read walls of text. {bot} only makes lengthy responses if and only if people are asking for assistance or an explanation that warrants it.";

const RANDOM_CHOICE_MACRO_REGEX =
  /\{\{\s*random(?:::\s*([^{}]+)|:\s*([^{}]+))\s*\}\}|\{\s*random(?:::\s*([^{}]+)|:\s*([^{}]+))\s*\}/gi;

export type MentionConverter = (
  text: string,
  client: Client,
  serverId: string,
  triggererName?: string,
  tomoriNickname?: string,
  personalMemoriesEnabled?: boolean,
  snapshot?: import("@/types/misc/context").RequestSnapshot,
) => Promise<string>;

/**
 * Resolves ST-style random choice macros that can appear in imported presets
 * or prompt fields. Each macro occurrence is rolled independently.
 */
export function resolveRandomChoiceMacros(text: string): string {
  return text.replace(
    RANDOM_CHOICE_MACRO_REGEX,
    (
      _match,
      doubleBraceColonOptions: string | undefined,
      doubleBraceCommaOptions: string | undefined,
      singleBraceColonOptions: string | undefined,
      singleBraceCommaOptions: string | undefined,
    ) => {
      const isColonSyntax = doubleBraceColonOptions !== undefined || singleBraceColonOptions !== undefined;
      const rawOptions =
        doubleBraceColonOptions ?? doubleBraceCommaOptions ?? singleBraceColonOptions ?? singleBraceCommaOptions ?? "";
      const separator = isColonSyntax ? "::" : ",";
      const items = rawOptions
        .split(separator)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

      if (items.length === 0) return "";
      return items[Math.floor(Math.random() * items.length)];
    },
  );
}

function resolveRandomChoiceMacrosInContextItem(item: StructuredContextItem): StructuredContextItem {
  let changed = false;
  const parts = item.parts.map((part): ContextPart => {
    if (part.type !== "text") return part;

    const resolvedText = resolveRandomChoiceMacros(part.text);
    if (resolvedText === part.text) return part;

    changed = true;
    return { ...part, text: resolvedText };
  });

  return changed ? { ...item, parts } : item;
}

export function resolveRandomChoiceMacrosInBuildOutput(output: {
  contextItems: StructuredContextItem[];
  tailDirectives: string[];
  lowerPriorityTailDirectives: string[];
  uncensorDirective?: string;
}): {
  contextItems: StructuredContextItem[];
  tailDirectives: string[];
  lowerPriorityTailDirectives: string[];
  uncensorDirective?: string;
} {
  return {
    contextItems: output.contextItems.map(resolveRandomChoiceMacrosInContextItem),
    tailDirectives: output.tailDirectives.map(resolveRandomChoiceMacros),
    lowerPriorityTailDirectives: output.lowerPriorityTailDirectives.map(resolveRandomChoiceMacros),
    uncensorDirective:
      output.uncensorDirective !== undefined ? resolveRandomChoiceMacros(output.uncensorDirective) : undefined,
  };
}

export async function buildConditioningContextItem(params: {
  client: Client;
  guildId: string;
  serverId: number;
  personaLineageId: number;
  botName: string;
  personalMemoriesEnabled: boolean;
  rewardEnabled: boolean;
  punishEnabled: boolean;
  convertMentions: MentionConverter;
}): Promise<StructuredContextItem | null> {
  const sections: string[] = [];

  const appendSection = async (conditioningType: ConditioningType, enabled: boolean): Promise<void> => {
    if (!enabled) {
      return;
    }

    const visibleGroups = (
      await loadConditioningGroupsForPersona(params.serverId, params.personaLineageId, conditioningType)
    )
      .filter((group) => group.reasonText.trim().length > 0)
      .slice(0, CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE);

    if (visibleGroups.length === 0) {
      return;
    }

    const heading =
      conditioningType === "reward"
        ? `## Rewarded Behaviors\nHere are past things ${params.botName} did that got rewarded for. Strive to do them again:`
        : `## Punished Behaviors\nHere are past things ${params.botName} did that got punished for. Avoid doing them again:`;

    const lines = visibleGroups.map((group) => {
      const users = group.userDiscIds.map((userDiscId) => `<@${userDiscId}>`).join(", ");
      const action = getConditioningContextPastParticiple(conditioningType, group.actionKey);
      const countSuffix = group.totalCount > 1 ? ` (${group.totalCount} times)` : "";
      const actionTextSuffix = group.actionText ? ` with \`${group.actionText}\`` : "";
      return `- [${params.botName} was ${action} by ${users}. Reason: \`${group.reasonText}\`${actionTextSuffix}]${countSuffix}`;
    });

    sections.push(`${heading}\n${lines.join("\n")}`);
  };

  await appendSection("reward", params.rewardEnabled);
  await appendSection("punish", params.punishEnabled);

  if (sections.length === 0) {
    return null;
  }

  return {
    role: "system",
    parts: [
      {
        type: "text",
        text: await params.convertMentions(
          sections.join("\n\n"),
          params.client,
          params.guildId,
          "User",
          params.botName,
          params.personalMemoriesEnabled,
        ),
      },
    ],
    metadataTag: ContextItemTag.KNOWLEDGE_SERVER_CONDITIONING,
  };
}
