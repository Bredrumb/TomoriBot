import { withProviderUsageContext } from "@/utils/provider/providerUsage";
import {
  createProviderUsageRecorder,
  findProviderRequestDeniedError,
  type ProviderUsageContext,
  getProviderRequestFailureCopy,
} from "@/utils/provider/providerUsage";
import type { ChatInputCommandInteraction, Client, TextBasedChannel } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { personaRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { getCapabilityCredentialFailureCopy, resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { getEffectiveLlmModelName } from "@/utils/provider/modelDisplay";
import { providerSupportsFeature } from "@/utils/provider/providerInfoRegistry";
import { resolveTextCredentialState } from "@/utils/provider/textModelSelection";
import { localizer } from "@/utils/text/localizer";
import { buildConversationContext } from "./historyExtraction";
import { promptForCompactOptions, promptForManualOptions } from "./modal";
import { buildConversationEmbed, buildManualEmbed, buildRoleplayEmbeds, isDiscordThreadChannel } from "./rendering";
import { postSummaryWithControls } from "./summaryControls";
import { generateCompactSummary } from "./summaryGeneration";
import { buildSupplementaryContext } from "./supplementaryContext";
import type { SendableChannel } from "./types";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export async function executeCompactCommand(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
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
  const baseState = await personaRepository.loadState(serverDiscId);
  if (!baseState) {
    await editError(
      modalSelection.submitInteraction,
      locale,
      "general.errors.tomori_not_setup_title",
      "general.errors.tomori_not_setup_description",
    );
    return;
  }

  let tomoriState: typeof baseState;
  let apiKey: string;
  let usageContext: ProviderUsageContext | undefined;
  try {
    const credentials = await resolveCapabilityCredentials(baseState.server_id, "text", {
      userId: userData.user_id,
      textModel: baseState.llm,
    });
    ({ apiKey, usageContext } = credentials);
    tomoriState = await resolveTextCredentialState(baseState, credentials);
  } catch (error) {
    const failure = getCapabilityCredentialFailureCopy(error, locale);
    if (failure) {
      await replyInfoEmbed(modalSelection.submitInteraction, locale, { ...failure, color: ColorCode.ERROR });
    } else {
      await log.error("Failed to resolve compact credentials", error as Error);
      await editError(
        modalSelection.submitInteraction,
        locale,
        "general.errors.unknown_error_title",
        "general.errors.unknown_error_description",
      );
    }
    return;
  }

  const providerName = tomoriState.llm.llm_provider.toLowerCase();
  const effectiveModelName = getEffectiveLlmModelName(tomoriState.llm, tomoriState.config.custom_model_name);
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
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      personaId: tomoriState.persona_id,
    }))
  )
    return;

  await modalSelection.submitInteraction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(localizer(locale, "commands.compact.processing_title"))
        .setDescription(localizer(locale, "commands.compact.processing_description"))
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
    const titleKey = targetThreadId ? "commands.compact.thread_invalid_title" : "general.errors.channel_only_title";
    const descriptionKey = targetThreadId
      ? "commands.compact.thread_invalid_description"
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
    const result = await withProviderUsageContext(usageContext, async () =>
      generateCompactSummary({
        summaryType: modalSelection.summaryType,
        providerName,
        apiKey,
        model: effectiveModelName,
        endpointUrl: tomoriState.config.custom_endpoint_url ?? undefined,
        context,
        supplementaryContext,
        systemPrompt: modalSelection.systemPrompt,
        analyzeImages: modalSelection.analyzeImages,
        onUsage: createProviderUsageRecorder(usageContext, effectiveModelName),
      }),
    );

    const denied = findProviderRequestDeniedError(result.cause, usageContext);
    if (denied) {
      await replyInfoEmbed(modalSelection.submitInteraction, locale, {
        ...getProviderRequestFailureCopy(denied, locale),
        color: ColorCode.ERROR,
      });
      return;
    }

    if (result.error || !result.summary) {
      await editFailure(modalSelection.submitInteraction, locale, result.error || "Unknown error");
      return;
    }

    await postSummaryWithControls({
      outputChannel,
      embed:
        modalSelection.summaryType === "conversation"
          ? buildConversationEmbed(locale, String(result.summary), modalSelection.refresh)
          : buildRoleplayEmbeds(locale, String(result.summary), modalSelection.refresh)[0],
      locale,
      refresh: modalSelection.refresh,
    });
    await editSuccess(modalSelection.submitInteraction, locale, targetChannelOption?.id ?? targetThreadId);
  } catch (error) {
    const denied = findProviderRequestDeniedError(error, usageContext);
    if (denied) {
      await replyInfoEmbed(modalSelection.submitInteraction, locale, {
        ...getProviderRequestFailureCopy(denied, locale),
        color: ColorCode.ERROR,
      });
      return;
    }
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
      titleKey: "commands.compact.destination_conflict_title",
      descriptionKey: "commands.compact.destination_conflict_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (targetThreadId && !DISCORD_SNOWFLAKE_PATTERN.test(targetThreadId)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.compact.thread_invalid_title",
      descriptionKey: "commands.compact.thread_invalid_description",
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
  userId?: number | null;
  serverId?: number;
  personaId?: number;
}): Promise<boolean> {
  if (!providerSupportsFeature(params.providerName, "conversationCompaction")) {
    log.warn(`[Compact] Provider "${params.providerLabel}" does not support conversation compaction`, undefined, {
      userId: params.userId,
      serverId: params.serverId,
      personaId: params.personaId,
      metadata: {
        command: "compact",
        provider: params.providerName,
        model: params.modelName,
      },
    });
    await editError(
      params.interaction,
      params.locale,
      "commands.compact.provider_unsupported_title",
      "commands.compact.provider_unsupported_description",
      {
        provider: params.providerLabel,
      },
    );
    return false;
  }
  if (params.wantsRoleplay && !params.supportsStructuredOutput) {
    log.warn(
      `[Compact] Roleplay compaction requested but model "${params.modelName}" does not support structured output`,
      undefined,
      {
        userId: params.userId,
        serverId: params.serverId,
        personaId: params.personaId,
        metadata: {
          command: "compact",
          model: params.modelName,
        },
      },
    );
    await editError(
      params.interaction,
      params.locale,
      "commands.compact.model_incompatible_title",
      "commands.compact.model_incompatible_description",
      {
        model_name: params.modelName,
      },
    );
    return false;
  }
  if (params.wantsImages && !params.seesImages) {
    log.warn(`[Compact] Image analysis requested but model "${params.modelName}" does not support vision`, undefined, {
      userId: params.userId,
      serverId: params.serverId,
      personaId: params.personaId,
      metadata: {
        command: "compact",
        model: params.modelName,
      },
    });
    await editError(
      params.interaction,
      params.locale,
      "commands.compact.image_vision_required_title",
      "commands.compact.image_vision_required_description",
      {
        model_name: params.modelName,
      },
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
        .setTitle(localizedStatusTitle(locale, titleKey, ColorCode.ERROR))
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
  await editError(interaction, locale, "commands.compact.failed_title", "commands.compact.failed_description", {
    error,
  });
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
    const titleKey = targetThreadId ? "commands.compact.thread_invalid_title" : "general.errors.channel_only_title";
    const descriptionKey = targetThreadId
      ? "commands.compact.thread_invalid_description"
      : "general.errors.channel_only_description";
    await editError(manualSelection.submitInteraction, locale, titleKey, descriptionKey);
    return;
  }

  try {
    await postSummaryWithControls({
      outputChannel,
      embed: buildManualEmbed(locale, manualSelection.summaryContent, manualSelection.refresh),
      locale,
      refresh: manualSelection.refresh,
    });
    await editSuccess(manualSelection.submitInteraction, locale, targetChannelOption?.id ?? targetThreadId);
  } catch (error) {
    log.error("Manual compact command failed", error);
    await editFailure(
      manualSelection.submitInteraction,
      locale,
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

async function editSuccess(
  interaction: { editReply: (options: { embeds: EmbedBuilder[] }) => Promise<unknown> },
  locale: string,
  targetDestinationId?: string,
): Promise<void> {
  const successDescription = targetDestinationId
    ? localizer(locale, "commands.compact.success_description_redirect", { channel: `<#${targetDestinationId}>` })
    : localizer(locale, "commands.compact.success_description");

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(localizedStatusTitle(locale, "commands.compact.success_title", ColorCode.SUCCESS))
        .setDescription(successDescription)
        .setColor(ColorCode.SUCCESS),
    ],
  });
}
