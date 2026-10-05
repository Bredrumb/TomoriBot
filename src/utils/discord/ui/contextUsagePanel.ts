import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ActionRowData,
  type ButtonComponentData,
  type ComponentInContainerData,
  type TopLevelComponentData,
} from "discord.js";
import { buildInteractionRouteId } from "@/utils/discord/interactions/routeRegistry";
import { buildPanelContainer } from "@/utils/discord/ui/panel";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";
import type { PromptInspection } from "@/utils/text/promptInspection/assemble";
import { CONTEXT_CELL_EMOJI, layoutContextGrid, measureContextUsage } from "@/utils/text/promptInspection/contextUsage";
import type { PromptSnapshotFormat } from "@/utils/text/promptInspection/delivery";

export const CONTEXT_ROUTE_NAMESPACE = "context";
export const CONTEXT_ROUTE_VERSION = "v1";

export interface ContextUsagePanelPayload {
  components: TopLevelComponentData[];
  flags: MessageFlags.IsComponentsV2;
}

/**
 * The button route carries the persona ID rather than the built prompt, so a click rebuilds the
 * snapshot from current state like every other panel route.
 */
function buildContextSnapshotRouteId(personaId: number, format: PromptSnapshotFormat): string {
  return buildInteractionRouteId(CONTEXT_ROUTE_NAMESPACE, CONTEXT_ROUTE_VERSION, "snapshot", String(personaId), format);
}

function formatTokens(locale: string, tokens: number): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(tokens);
}

function formatShare(locale: string, tokens: number, capacityTokens: number): string {
  const share = capacityTokens > 0 ? tokens / capacityTokens : 0;
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(share);
}

function buildSnapshotButtonRow(
  locale: string,
  personaId: number,
  canViewText: boolean,
): ActionRowData<ButtonComponentData> {
  return {
    type: ComponentType.ActionRow,
    components: (["text", "json"] as const).map((format) => ({
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: buildContextSnapshotRouteId(personaId, format),
      label: localizer(locale, `commands.context.view_${format}_button`),
      disabled: !canViewText,
    })),
  };
}

/**
 * Renders the context window as an emoji grid with a legend, followed by the snapshot buttons.
 * Members without full-prompt access see the buttons disabled, so they learn the view exists.
 */
export function buildContextUsagePayload(
  locale: string,
  inspection: PromptInspection,
  canViewText: boolean,
): ContextUsagePanelPayload {
  const usage = measureContextUsage(inspection.contextItems, inspection.toolsData);
  const grid = layoutContextGrid(usage, inspection.budget);
  const providerLabel = getProviderDisplayName(inspection.answeringState.llm.llm_provider);

  const headerLines = [
    `### ${localizer(locale, "commands.context.title")}`,
    localizer(locale, "commands.context.target_line", {
      persona_name: inspection.selectedPersona.persona_nickname,
      model: inspection.modelName,
      provider: providerLabel,
    }),
    inspection.budget
      ? localizer(locale, "commands.context.usage_line", {
          used: formatTokens(locale, usage.inputTokens),
          window: formatTokens(locale, inspection.budget.contextLength),
          share: formatShare(locale, usage.inputTokens, inspection.budget.contextLength),
        })
      : localizer(locale, "commands.context.usage_unknown_window", { used: formatTokens(locale, usage.inputTokens) }),
  ];

  const legendLines = grid.parts.map((part) =>
    localizer(locale, "commands.context.legend_line", {
      emoji: CONTEXT_CELL_EMOJI[part.id],
      label: localizer(locale, `commands.context.segment_${part.id}`),
      tokens: formatTokens(locale, part.tokens),
      share: formatShare(locale, part.tokens, grid.capacityTokens),
    }),
  );

  const footnotes = [localizer(locale, "commands.context.estimate_note")];
  if (inspection.historyPairsDropped > 0) {
    footnotes.unshift(localizer(locale, "commands.context.truncated_note", { count: inspection.historyPairsDropped }));
  }
  if (!canViewText) {
    footnotes.push(localizer(locale, "commands.context.text_locked_note"));
  }

  const containerComponents: ComponentInContainerData[] = [
    { type: ComponentType.TextDisplay, content: headerLines.join("\n") },
  ];
  if (grid.rows.length > 0) {
    containerComponents.push({ type: ComponentType.TextDisplay, content: grid.rows.join("\n") });
  }
  containerComponents.push(
    { type: ComponentType.TextDisplay, content: legendLines.join("\n") },
    { type: ComponentType.TextDisplay, content: footnotes.map((note) => `-# ${note}`).join("\n") },
  );

  const personaId = inspection.selectedPersona.persona_id;
  if (typeof personaId === "number") {
    containerComponents.push(buildSnapshotButtonRow(locale, personaId, canViewText));
  }

  return {
    components: [buildPanelContainer(containerComponents)],
    flags: MessageFlags.IsComponentsV2,
  };
}
