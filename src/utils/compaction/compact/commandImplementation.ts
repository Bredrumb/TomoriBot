import type { ChatInputCommandInteraction, Client, TextBasedChannel } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { personaRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { getEffectiveLlmModelName } from "@/utils/provider/modelDisplay";
import { providerSupportsFeature } from "@/utils/provider/providerInfoRegistry";
import { decryptApiKey } from "@/utils/security/crypto";
import { localizer } from "@/utils/text/localizer";
import { buildConversationContext } from "./historyExtraction";
import { promptForCompactOptions } from "./modal";
import { buildConversationEmbed, buildRoleplayEmbeds, isDiscordThreadChannel, sendEmbedsInChunks } from "./rendering";
import { generateCompactSummary } from "./summaryGeneration";
import { buildRoleplayAvatarMap, buildSupplementaryContext } from "./supplementaryContext";
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

    const embeds =
      modalSelection.summaryType === "conversation"
        ? [buildConversationEmbed(locale, String(result.summary), modalSelection.refresh)]
        : buildRoleplayEmbeds(
            locale,
            typeof result.summary === "string"
              ? { overall_scene_summary: result.summary, characters: [] }
              : result.summary,
            modalSelection.refresh,
            await buildRoleplayAvatarMap({
              userIds: context.userIds,
              client,
              guild: interaction.guild ?? null,
              serverDiscId,
            }),
          );

    await sendEmbedsInChunks(outputChannel, embeds);
    await editSuccess(modalSelection.submitInteraction, locale, targetChannelOption?.id ?? targetThreadId);
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
