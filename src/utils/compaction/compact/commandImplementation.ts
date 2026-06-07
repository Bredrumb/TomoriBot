import type { ChatInputCommandInteraction, Client, TextBasedChannel } from "discord.js";
import {
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { personaRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { getEffectiveLlmModelName } from "@/utils/provider/modelDisplay";
import { providerSupportsFeature } from "@/utils/provider/providerInfoRegistry";
import { decryptApiKey } from "@/utils/security/crypto";
import { localizer } from "@/utils/text/localizer";
import { buildConversationContext } from "./historyExtraction";
import { promptForCompactOptions, promptForManualOptions } from "./modal";
import {
  COMPACT_EDIT_BUTTON_ID,
  buildConversationEmbed,
  buildEditSummaryButtonRow,
  buildManualEmbed,
  buildRoleplayEmbeds,
  isDiscordThreadChannel,
} from "./rendering";
import { generateCompactSummary } from "./summaryGeneration";
import { buildSupplementaryContext } from "./supplementaryContext";
import type { SendableChannel } from "./types";

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export async function executeCompactCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const summaryType = interaction.options.getString("type", true) as import("@/types/misc/compact").CompactSummaryMode;
  const targetChannelOption = interaction.options.getChannel("channel");
  const targetThreadId = interaction.options.getString("thread")?.trim();
  if (!(await validateDestinationOptions(interaction, locale, targetChannelOption?.id, targetThreadId))) return;

  if (summaryType === "manual") {
    await executeManualCompact(client, interaction, locale, targetChannelOption, targetThreadId);
    return;
  }

  const modalSelection = await promptForCompactOptions(interaction, locale, summaryType);
  if (!modalSelection) return;

  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  const tomoriState = await personaRepository.loadState(serverDiscId);
  if (!tomoriState) {
    await editError(
      modalSelection.submitInteraction,
      locale,
      "general.errors.tomori_not_setup_title",
      "general.errors.tomori_not_setup_description",
    );
    return;
  }

  const providerName = tomoriState.llm.llm_provider.toLowerCase();
  const effectiveModelName = getEffectiveLlmModelName(tomoriState.llm, tomoriState.config.custom_model_name);
  const encryptedApiKey = tomoriState.config.api_key;
  if (
    !(await validateProviderReadiness({
      interaction: modalSelection.submitInteraction,
      locale,
      providerName,
      providerLabel: tomoriState.llm.llm_provider,
      modelName: effectiveModelName,
      supportsStructuredOutput: tomoriState.llm.supports_structoutput,
      seesImages: tomoriState.llm.sees_images,
      wantsRoleplay: modalSelection.summaryType === "roleplay",
      wantsImages: modalSelection.analyzeImages,
      encryptedApiKey,
    }))
  ) {
    return;
  }

  if (!encryptedApiKey) {
    await editError(
      modalSelection.submitInteraction,
      locale,
      "general.errors.api_key_missing_title",
      "general.errors.api_key_missing_description",
    );
    return;
  }

  const apiKey = await decryptApiKey(encryptedApiKey, tomoriState.config.key_version || 1);
  if (!apiKey) {
    await editError(
      modalSelection.submitInteraction,
      locale,
      "general.errors.api_key_error_title",
      "general.errors.api_key_error_description",
    );
    return;
  }

  await modalSelection.submitInteraction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(localizer(locale, "commands.tool.compact.processing_title"))
        .setDescription(localizer(locale, "commands.tool.compact.processing_description"))
        .setColor(ColorCode.INFO),
    ],
  });

  const channel = modalSelection.submitInteraction.channel ?? interaction.channel;
  if (!channel || !("send" in channel) || typeof channel.send !== "function" || !("messages" in channel)) {
    await editError(
      modalSelection.submitInteraction,
      locale,
      "general.errors.channel_only_title",
      "general.errors.channel_only_description",
    );
    return;
  }

  const outputChannel = await resolveOutputChannel(
    client,
    interaction.guildId,
    channel as SendableChannel,
    targetChannelOption?.id,
    targetThreadId,
  );
  if (!outputChannel) {
    const titleKey = targetThreadId
      ? "commands.tool.compact.thread_invalid_title"
      : "general.errors.channel_only_title";
    const descriptionKey = targetThreadId
      ? "commands.tool.compact.thread_invalid_description"
      : "general.errors.channel_only_description";
    await editError(modalSelection.submitInteraction, locale, titleKey, descriptionKey);
    return;
  }

  try {
    const context = await buildConversationContext(channel as TextBasedChannel, modalSelection.analyzeImages);
    const supplementaryContext = await buildSupplementaryContext({
      serverDiscId,
      userIds: context.userIds,
      includePersonas: true,
    });
    const result = await generateCompactSummary({
      summaryType: modalSelection.summaryType,
      providerName,
      apiKey,
      model: effectiveModelName,
      endpointUrl: tomoriState.config.custom_endpoint_url ?? undefined,
      context,
      supplementaryContext,
      systemPrompt: modalSelection.systemPrompt,
      analyzeImages: modalSelection.analyzeImages,
    });

    if (result.error || !result.summary) {
      await editFailure(modalSelection.submitInteraction, locale, result.error || "Unknown error");
      return;
    }

    const COLLECTOR_DURATION_MS = 10 * 60 * 1000;
    const deadlineDate = new Date(Date.now() + COLLECTOR_DURATION_MS);
    const editDeadline = formatDeadline(deadlineDate);

    const buildEmbed = (text: string, deadline?: string) =>
      modalSelection.summaryType === "conversation"
        ? buildConversationEmbed(locale, text, modalSelection.refresh, deadline)
        : buildRoleplayEmbeds(locale, text, modalSelection.refresh, deadline)[0];

    const summaryText = String(result.summary);
    const buttonRow = buildEditSummaryButtonRow(locale);
    const summaryMessage = await outputChannel.send({
      embeds: [buildEmbed(summaryText, editDeadline)],
      components: [buttonRow],
    });
    await editSuccess(modalSelection.submitInteraction, locale, targetChannelOption?.id ?? targetThreadId);

    const collector = summaryMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.customId === COMPACT_EDIT_BUTTON_ID,
      time: COLLECTOR_DURATION_MS,
    });

    collector.on("collect", async (buttonInteraction) => {
      const liveMessage = await buttonInteraction.message.fetch();
      const currentText = liveMessage.embeds[0]?.description ?? "";
      const editModal = new ModalBuilder()
        .setCustomId("compact_edit_modal")
        .setTitle(localizer(locale, "commands.tool.compact.edit_modal_title"));
      const textInput = new TextInputBuilder()
        .setCustomId("compact_edit_text")
        .setLabel(localizer(locale, "commands.tool.compact.edit_field_label"))
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(4000)
        .setRequired(true)
        .setValue(currentText.slice(0, 4000));
      editModal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(textInput));
      await buttonInteraction.showModal(editModal);

      try {
        const submitted = await buttonInteraction.awaitModalSubmit({
          time: 600000,
          filter: (i) => i.customId === "compact_edit_modal" && i.user.id === buttonInteraction.user.id,
        });
        const newText = submitted.fields.getTextInputValue("compact_edit_text");
        await submitted.deferUpdate();
        await summaryMessage.edit({ embeds: [buildEmbed(newText, editDeadline)], components: [buttonRow] });
      } catch {
        // Modal dismissed or timed out — no action needed
      }
    });

    collector.on("end", async () => {
      const liveMessage = await summaryMessage.fetch().catch(() => null);
      if (!liveMessage) return;
      const currentText = liveMessage.embeds[0]?.description ?? "";
      await summaryMessage.edit({ embeds: [buildEmbed(currentText)], components: [] }).catch(() => {});
    });
  } catch (error) {
    log.error("Compact summary command failed", error);
    await editFailure(
      modalSelection.submitInteraction,
      locale,
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

async function validateDestinationOptions(
  interaction: ChatInputCommandInteraction,
  locale: string,
  targetChannelId?: string,
  targetThreadId?: string,
): Promise<boolean> {
  if (targetChannelId && targetThreadId) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.tool.compact.destination_conflict_title",
      descriptionKey: "commands.tool.compact.destination_conflict_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (targetThreadId && !DISCORD_SNOWFLAKE_PATTERN.test(targetThreadId)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.tool.compact.thread_invalid_title",
      descriptionKey: "commands.tool.compact.thread_invalid_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  return true;
}

async function validateProviderReadiness(params: {
  interaction: { editReply: (options: { embeds: EmbedBuilder[] }) => Promise<unknown> };
  locale: string;
  providerName: string;
  providerLabel: string;
  modelName: string;
  supportsStructuredOutput: boolean;
  seesImages: boolean;
  wantsRoleplay: boolean;
  wantsImages: boolean;
  encryptedApiKey: Buffer | null | undefined;
}): Promise<boolean> {
  if (!providerSupportsFeature(params.providerName, "conversationCompaction")) {
    await editError(
      params.interaction,
      params.locale,
      "commands.tool.compact.provider_unsupported_title",
      "commands.tool.compact.provider_unsupported_description",
      {
        provider: params.providerLabel,
      },
    );
    return false;
  }
  if (params.wantsRoleplay && !params.supportsStructuredOutput) {
    await editError(
      params.interaction,
      params.locale,
      "commands.tool.compact.model_incompatible_title",
      "commands.tool.compact.model_incompatible_description",
      {
        model_name: params.modelName,
      },
    );
    return false;
  }
  if (params.wantsImages && !params.seesImages) {
    await editError(
      params.interaction,
      params.locale,
      "commands.tool.compact.image_vision_required_title",
      "commands.tool.compact.image_vision_required_description",
      {
        model_name: params.modelName,
      },
    );
    return false;
  }
  if (!params.encryptedApiKey) {
    await editError(
      params.interaction,
      params.locale,
      "general.errors.api_key_missing_title",
      "general.errors.api_key_missing_description",
    );
    return false;
  }
  return true;
}

async function resolveOutputChannel(
  client: Client,
  guildId: string | null,
  currentChannel: SendableChannel,
  targetChannelId?: string,
  targetThreadId?: string,
): Promise<SendableChannel | null> {
  if (targetChannelId) {
    const fetchedTarget = await client.channels.fetch(targetChannelId).catch(() => null);
    return fetchedTarget && "send" in fetchedTarget ? (fetchedTarget as SendableChannel) : null;
  }
  if (targetThreadId) {
    const fetchedTarget = await client.channels.fetch(targetThreadId).catch(() => null);
    return fetchedTarget &&
      isDiscordThreadChannel(fetchedTarget) &&
      "guildId" in fetchedTarget &&
      fetchedTarget.guildId === guildId &&
      "send" in fetchedTarget &&
      typeof fetchedTarget.send === "function"
      ? (fetchedTarget as SendableChannel)
      : null;
  }
  return currentChannel;
}

async function editError(
  interaction: { editReply: (options: { embeds: EmbedBuilder[] }) => Promise<unknown> },
  locale: string,
  titleKey: string,
  descriptionKey: string,
  descriptionVars?: Record<string, string>,
): Promise<void> {
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(localizer(locale, titleKey))
        .setDescription(localizer(locale, descriptionKey, descriptionVars))
        .setColor(ColorCode.ERROR),
    ],
  });
}

async function editFailure(
  interaction: { editReply: (options: { embeds: EmbedBuilder[] }) => Promise<unknown> },
  locale: string,
  error: string,
): Promise<void> {
  await editError(
    interaction,
    locale,
    "commands.tool.compact.failed_title",
    "commands.tool.compact.failed_description",
    {
      error,
    },
  );
}

async function executeManualCompact(
  client: Client,
  interaction: ChatInputCommandInteraction,
  locale: string,
  targetChannelOption: ReturnType<ChatInputCommandInteraction["options"]["getChannel"]>,
  targetThreadId: string | undefined,
): Promise<void> {
  const manualSelection = await promptForManualOptions(interaction, locale);
  if (!manualSelection) return;

  const channel = manualSelection.submitInteraction.channel ?? interaction.channel;
  if (!channel || !("send" in channel) || typeof channel.send !== "function" || !("messages" in channel)) {
    await editError(
      manualSelection.submitInteraction,
      locale,
      "general.errors.channel_only_title",
      "general.errors.channel_only_description",
    );
    return;
  }

  const outputChannel = await resolveOutputChannel(
    client,
    interaction.guildId,
    channel as SendableChannel,
    targetChannelOption?.id,
    targetThreadId,
  );
  if (!outputChannel) {
    const titleKey = targetThreadId
      ? "commands.tool.compact.thread_invalid_title"
      : "general.errors.channel_only_title";
    const descriptionKey = targetThreadId
      ? "commands.tool.compact.thread_invalid_description"
      : "general.errors.channel_only_description";
    await editError(manualSelection.submitInteraction, locale, titleKey, descriptionKey);
    return;
  }

  try {
    const COLLECTOR_DURATION_MS = 10 * 60 * 1000;
    const editDeadline = formatDeadline(new Date(Date.now() + COLLECTOR_DURATION_MS));
    const buildEmbed = (text: string, deadline?: string) =>
      buildManualEmbed(locale, text, manualSelection.refresh, deadline);

    const buttonRow = buildEditSummaryButtonRow(locale);
    const summaryMessage = await outputChannel.send({
      embeds: [buildEmbed(manualSelection.summaryContent, editDeadline)],
      components: [buttonRow],
    });
    await editSuccess(manualSelection.submitInteraction, locale, targetChannelOption?.id ?? targetThreadId);

    const collector = summaryMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.customId === COMPACT_EDIT_BUTTON_ID,
      time: COLLECTOR_DURATION_MS,
    });

    collector.on("collect", async (buttonInteraction) => {
      const liveMessage = await buttonInteraction.message.fetch();
      const currentText = liveMessage.embeds[0]?.description ?? "";
      const editModal = new ModalBuilder()
        .setCustomId("compact_edit_modal")
        .setTitle(localizer(locale, "commands.tool.compact.edit_modal_title"));
      const textInput = new TextInputBuilder()
        .setCustomId("compact_edit_text")
        .setLabel(localizer(locale, "commands.tool.compact.edit_field_label"))
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(4000)
        .setRequired(true)
        .setValue(currentText.slice(0, 4000));
      editModal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(textInput));
      await buttonInteraction.showModal(editModal);

      try {
        const submitted = await buttonInteraction.awaitModalSubmit({
          time: 600000,
          filter: (i) => i.customId === "compact_edit_modal" && i.user.id === buttonInteraction.user.id,
        });
        const newText = submitted.fields.getTextInputValue("compact_edit_text");
        await submitted.deferUpdate();
        await summaryMessage.edit({ embeds: [buildEmbed(newText, editDeadline)], components: [buttonRow] });
      } catch {
        // Modal dismissed or timed out — no action needed
      }
    });

    collector.on("end", async () => {
      const liveMessage = await summaryMessage.fetch().catch(() => null);
      if (!liveMessage) return;
      const currentText = liveMessage.embeds[0]?.description ?? "";
      await summaryMessage.edit({ embeds: [buildEmbed(currentText)], components: [] }).catch(() => {});
    });
  } catch (error) {
    log.error("Manual compact command failed", error);
    await editFailure(
      manualSelection.submitInteraction,
      locale,
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

function formatDeadline(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getUTCFullYear());
  return `${hh}:${mm} ${dd}/${mo}/${yyyy}`;
}

async function editSuccess(
  interaction: { editReply: (options: { embeds: EmbedBuilder[] }) => Promise<unknown> },
  locale: string,
  targetDestinationId?: string,
): Promise<void> {
  const successDescription = targetDestinationId
    ? localizer(locale, "commands.tool.compact.success_description_redirect", { channel: `<#${targetDestinationId}>` })
    : localizer(locale, "commands.tool.compact.success_description");

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(localizer(locale, "commands.tool.compact.success_title"))
        .setDescription(successDescription)
        .setColor(ColorCode.SUCCESS),
    ],
  });
}
