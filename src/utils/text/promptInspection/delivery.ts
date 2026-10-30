import { resolveRequestMaxOutputTokens } from "@/utils/provider/modelLimits";
import {
  AttachmentBuilder,
  ComponentType,
  MessageFlags,
  type InteractionEditReplyOptions,
  type TopLevelComponentData,
} from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { buildPanelContainer, type PanelAccentTone } from "@/utils/discord/ui/panel";
import { statusNote } from "@/utils/discord/ui/statusTitle";
import { localizer } from "@/utils/text/localizer";
import type { PromptInspection } from "@/utils/text/promptInspection/assemble";
import { buildJsonSnapshot, buildRequestConfig, buildTextSnapshot } from "@/utils/text/promptInspection/serialize";

export type PromptSnapshotFormat = "text" | "json";

/**
 * Whether a member may receive the full prompt text. Token counts stay visible to everyone; the
 * text itself carries other members' memories and the server's prompts, so it is gated.
 */
export function canViewPromptText(
  memberPermissions: { has(permission: "ManageGuild"): boolean } | null,
  tomoriState: TomoriState,
): boolean {
  return (memberPermissions?.has("ManageGuild") ?? false) || (tomoriState.config.prompt_snapshot_enabled ?? false);
}

export interface PromptSnapshotDelivery {
  inspection: PromptInspection;
  format: PromptSnapshotFormat;
  guildId: string;
  locale: string;
  /** `/tool prompt snapshot` points users at its own options; `/context` has buttons instead. */
  includeRerunHints: boolean;
  editReply(options: InteractionEditReplyOptions): Promise<unknown>;
}

/**
 * Answers on the deferred ephemeral reply rather than by DM: a snapshot is a one-time debugging
 * view, not a backup worth keeping, and the reply is already private to the requester.
 */
export async function deliverPromptSnapshot(delivery: PromptSnapshotDelivery): Promise<void> {
  const { inspection, format, locale } = delivery;
  const { selectedPersona, providerName, modelName, toolsData } = inspection;

  const requestConfig = buildRequestConfig(
    inspection.answeringState,
    providerName,
    modelName,
    await resolveRequestMaxOutputTokens(inspection.answeringState),
  );

  let fileContent: string;
  let fileName: string;
  const fileStem = `prompt-snapshot-${inspection.channelId}-${selectedPersona.persona_lineage_id}-${Date.now()}`;

  if (format === "json") {
    const snapshotData = await buildJsonSnapshot(
      inspection.contextItems,
      inspection.answeringState,
      providerName,
      modelName,
      toolsData,
      requestConfig,
    );
    fileContent = JSON.stringify(snapshotData, null, 2);
    fileName = `${fileStem}.json`;
  } else {
    const infoLines = [
      `server_id: ${delivery.guildId}`,
      `channel: #${inspection.channelName}`,
      `persona: ${selectedPersona.persona_nickname}`,
      `provider: ${providerName}`,
      `model: ${modelName}`,
      `preset: ${inspection.presetName ?? "(native)"}`,
      `captured: ${inspection.capturedAt}`,
    ];
    fileContent = buildTextSnapshot(inspection.contextItems, requestConfig, infoLines);
    fileName = `${fileStem}.txt`;
  }

  const attachment = new AttachmentBuilder(Buffer.from(fileContent, "utf-8"), { name: fileName });
  const formatLabel = format === "json" ? "JSON" : "Text";

  const descriptionParts: string[] = [];
  descriptionParts.push(
    localizer(locale, "commands.tool.prompt.snapshot.file_description", {
      persona_name: selectedPersona.persona_nickname,
      format: formatLabel,
    }),
  );
  if (format === "text") {
    descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.file_txt_headers_note"));
    if (delivery.includeRerunHints) {
      descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.file_hint_try_json"));
    }
  } else {
    if (delivery.includeRerunHints) {
      descriptionParts.push(localizer(locale, "commands.tool.prompt.snapshot.file_hint_try_text"));
    }
    if (toolsData) {
      descriptionParts.push(
        statusNote("warning", localizer(locale, "commands.tool.prompt.snapshot.file_tools_filtering_note")),
      );
    }
  }
  if (inspection.historyPairsDropped > 0) {
    descriptionParts.push(
      statusNote(
        "warning",
        localizer(locale, "commands.tool.prompt.snapshot.file_truncated_note", {
          count: inspection.historyPairsDropped,
        }),
      ),
    );
  }
  descriptionParts.push(statusNote("error", localizer(locale, "commands.tool.prompt.snapshot.file_privacy_warning")));

  await delivery.editReply({
    components: buildSnapshotCard(
      localizer(locale, "commands.tool.prompt.snapshot.file_title"),
      descriptionParts.join("\n\n"),
      fileName,
      "info",
    ),
    flags: MessageFlags.IsComponentsV2,
    files: [attachment],
  });
}

/**
 * Discord renders message attachments above embeds, so the file rides inside a Components V2
 * container instead, where a File component can follow the text and sit at the bottom.
 */
function buildSnapshotCard(
  title: string,
  body: string,
  attachmentName: string,
  tone: PanelAccentTone,
): TopLevelComponentData[] {
  return [
    buildPanelContainer(
      [
        { type: ComponentType.TextDisplay, content: `### ${title}\n${body}` },
        { type: ComponentType.File, file: { url: `attachment://${attachmentName}` } },
      ],
      tone,
      { formatProse: false },
    ),
  ];
}
