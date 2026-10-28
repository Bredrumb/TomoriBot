import {
  addGenerationModelOption,
  createGenerationModelAutocomplete,
  resolveGenerationModelOption,
  replyGenerationModelUnavailable,
} from "@/utils/discord/autocomplete/generationModelAutocomplete";
import { GenerationModelUnavailableError, validateGenerationModelSelection } from "@/utils/provider/generationModels";
import type { GenerationModelSelection } from "@/types/provider/generationModels";
import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  TextInputStyle,
  type APIAttachment,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import { decryptApiKey, getOptApiKey } from "@/utils/security/crypto";
import {
  CredentialUnavailableError,
  getResolvedCapabilityModelId,
  resolveCapabilityCredentials,
} from "@/utils/provider/credentialResolver";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { checkImageQuota, incrementImageQuota } from "@/utils/quota/imageQuotaManager";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { statRepository } from "@/utils/db/repositories";
import { resolveNaiImageParams } from "@/utils/image/naiImageParams";
import { resolveNaiDiffusionModel } from "@/utils/image/naiDiffusionModels";
import { normalizeNaiReferenceImage } from "@/utils/image/imageProcessor";
import { prepareGeneratedImage } from "@/utils/image/generatedImageMetadata";
import { buildImageGenerationInputAttachment } from "@/utils/image/imageGenerationInput";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import { withProviderOptionCopy } from "@/utils/provider/providerOptionRegistry";
import {
  NAI_CHAR_REF_INFO_EXTRACTED,
  NAI_CHAR_REF_STRENGTH,
  NAI_DEFAULT_NEGATIVE_PROMPT,
  classifyNaiImageError,
  generateNovelAiImage,
  supportsNaiPreciseReference,
  type NaiGenerationCharacterPayload,
} from "@/utils/image/naiImageGeneration";

const MODAL_CUSTOM_ID = "novelai_generate_image_modal";
const PROMPT_INPUT_ID = "nai_image_prompt";
const NEGATIVE_TAGS_INPUT_ID = "nai_image_negative_tags";
const CHARACTER_REFERENCE_INPUT_ID = "nai_image_character_reference";
const ORIENTATION_SELECT_ID = "nai_image_orientation";

function splitTags(rawTags: string): string[] {
  return rawTags
    .split(/[,\u3001]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

async function resolveServerNovelAiApiKey(tomoriState: TomoriState): Promise<string | null> {
  const optKey = await getOptApiKey(tomoriState.server_id, "novelai");
  if (optKey) return optKey;

  const encryptedApiKey = tomoriState.config.api_key;
  if (!encryptedApiKey) return null;
  return await decryptApiKey(encryptedApiKey, tomoriState.config.key_version || 1);
}

async function resolveSelectedNaiCredentials(
  serverId: number,
  userId: number | null,
  modelSelection: GenerationModelSelection,
) {
  await validateGenerationModelSelection(serverId, userId, modelSelection);
  if (modelSelection.source === "server") {
    const apiKey = await getOptApiKey(serverId, "novelai");
    if (apiKey) return { apiKey, source: "server" as const, modelId: modelSelection.modelId };
  }
  const resolved = await resolveCapabilityCredentials(serverId, "image-nai", { userId, modelSelection });
  return { apiKey: resolved.apiKey, source: resolved.source, modelId: modelSelection.modelId };
}

async function prepareCharacterReferencePayload(attachment: APIAttachment): Promise<NaiGenerationCharacterPayload> {
  if (!attachment.content_type?.startsWith("image/")) {
    throw new Error("Invalid character reference image type");
  }

  const downloadResult = await safeDownload(attachment.url, {
    maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
    timeoutMs: 10_000,
    knownSize: attachment.size,
  });
  if (!downloadResult.success || !downloadResult.buffer) {
    throw new Error(
      `Failed to fetch character reference image: ${downloadResult.details ?? downloadResult.error ?? "unknown error"}`,
    );
  }

  const normalizedBuffer = await normalizeNaiReferenceImage(downloadResult.buffer);

  return {
    useCoords: false,
    referenceImages: [normalizedBuffer.toString("base64")],
    referenceStrengths: [NAI_CHAR_REF_STRENGTH],
    referenceInfoExtracted: [NAI_CHAR_REF_INFO_EXTRACTED],
  };
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  addGenerationModelOption(
    subcommand
      .setName("image")
      .setDescription(localizer("en-US", "commands.novelai.generate.image.description"))
      .addBooleanOption((option) =>
        option
          .setName("nsfw")
          .setDescription(localizer("en-US", "commands.novelai.generate.image.nsfw_description"))
          .setRequired(false),
      ),
    "commands.novelai.generate.image.model_description",
  );

export const autocomplete = createGenerationModelAutocomplete("image-nai");

export async function execute(
  _client: Client,
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

  const serverId = interaction.guild?.id ?? interaction.user.id;
  let modalSubmitInteraction: ModalSubmitInteraction | undefined;
  let tomoriState: TomoriState | null = null;
  let resolvedModel: Awaited<ReturnType<typeof resolveNaiDiffusionModel>> | null = null;
  let imageCreds: { apiKey: string; source: "server" | "personal"; modelId: number | null } | undefined;
  let submittedInput:
    | { prompt: string; negativeTags: string; orientation: string; referenceFilenames: string[] }
    | undefined;
  const recoveryOptions = () =>
    submittedInput
      ? {
          footerKey: "commands.generate.image.recovery_file_footer",
          files: [buildImageGenerationInputAttachment(locale, { kind: "novelai", ...submittedInput })],
        }
      : {};
  const recoveryTips = async (tipKeys: string[], credentialSource: "server" | "personal") => {
    return withProviderOptionCopy(tipKeys, {
      surface: "recovery",
      managedProvider: null,
      userDiscId: interaction.user.id,
      serverId: tomoriState?.server_id,
      credentialScope: credentialSource,
    });
  };

  try {
    tomoriState = await getCachedTomoriState(serverId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modelSelection = await resolveGenerationModelOption(
      interaction,
      tomoriState.server_id,
      userData.user_id ?? null,
      locale,
      "image-nai",
    );
    if (modelSelection === false) return;
    const spoiler = interaction.options.getBoolean("nsfw") ?? false;

    // Overlay the invoking user's personal (BYOK) provider selections so their
    // personal NovelAI model/key is used when configured, mirroring /generate image.
    const serverTomoriState = tomoriState;
    const overlay = await applyPersonalProviderSelectionsToTomoriState(tomoriState, userData.user_id ?? null);
    tomoriState = overlay.tomoriState;

    if (!tomoriState.config.imagegen_enabled) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.generate.image.disabled_title",
        descriptionKey: "commands.generate.image.disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (modelSelection) {
      imageCreds = await resolveSelectedNaiCredentials(tomoriState.server_id, userData.user_id ?? null, modelSelection);
    } else if (overlay.activeConfigs.image_nai) {
      try {
        const resolved = await resolveCapabilityCredentials(tomoriState.server_id, "image-nai", {
          userId: userData.user_id ?? null,
        });
        imageCreds = {
          apiKey: resolved.apiKey,
          source: resolved.source,
          modelId: getResolvedCapabilityModelId(resolved, "image-nai"),
        };
      } catch (error) {
        if (error instanceof CredentialUnavailableError) {
          if (!interaction.replied && !interaction.deferred)
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          await replyInfoEmbed(interaction, locale, {
            titleKey: "general.errors.personal_provider_credentials_error_title",
            descriptionKey: "general.errors.personal_provider_credentials_error_description",
            tipKeys: await recoveryTips([], "personal"),
            color: ColorCode.ERROR,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        throw error;
      }
    } else {
      const apiKey = await resolveServerNovelAiApiKey(serverTomoriState);
      if (apiKey) imageCreds = { apiKey, source: "server", modelId: null };
    }

    if (!imageCreds) {
      if (!interaction.replied && !interaction.deferred)
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.novelai.generate.image.no_api_key_title",
        descriptionKey: "commands.novelai.generate.image.no_api_key_description",
        tipKeys: await recoveryTips([], "server"),
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    resolvedModel = await resolveNaiDiffusionModel({
      ...tomoriState.config,
      nai_diffusion_model_id: imageCreds.modelId ?? tomoriState.config.nai_diffusion_model_id,
    });
    if (modelSelection && resolvedModel?.diffusionModelId !== modelSelection.modelId)
      throw new GenerationModelUnavailableError();
    if (!resolvedModel) {
      log.warn(
        `[NovelAI Generate Image] No NovelAI diffusion model resolved for server ${tomoriState.server_id}`,
        undefined,
        {
          userId: userData.user_id,
          serverId: tomoriState.server_id,
          personaId: tomoriState.persona_id,
          metadata: {
            command: "novelai generate image",
          },
        },
      );
      if (!interaction.replied && !interaction.deferred)
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.novelai.generate.image.no_model_title",
        descriptionKey: "commands.novelai.generate.image.no_model_description",
        tipKeys: await recoveryTips([], imageCreds.source),
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let apiKey = imageCreds.apiKey;

    const effectiveImageParams = resolveNaiImageParams(tomoriState.config);

    if (imageCreds.source === "server") {
      const quotaCheck = await checkImageQuota(tomoriState.server_id, interaction.user.id);
      if (!quotaCheck.allowed) {
        const errorTitleKey = "commands.generate.image.quota_exceeded_title";
        let errorDescriptionKey = "commands.generate.image.quota_exceeded_description";
        const descriptionVars: Record<string, string> = {};

        if (quotaCheck.resetTime) {
          const now = new Date();
          const hoursUntilReset = Math.ceil((quotaCheck.resetTime.getTime() - now.getTime()) / (1000 * 60 * 60));

          if (hoursUntilReset < 24) {
            descriptionVars.reset_info = localizer(locale, "commands.generate.image.quota_resets_in_hours", {
              hours: hoursUntilReset.toString(),
            });
          } else {
            descriptionVars.reset_info = localizer(locale, "commands.generate.image.quota_resets_in_days", {
              days: Math.ceil(hoursUntilReset / 24).toString(),
            });
          }
        }

        if (quotaCheck.reason === "user_quota_exceeded") {
          errorDescriptionKey = "commands.generate.image.user_quota_exceeded_description";
        } else if (quotaCheck.reason === "serverwide_quota_exceeded") {
          errorDescriptionKey = "commands.generate.image.serverwide_quota_exceeded_description";
        }

        if (!interaction.replied && !interaction.deferred)
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await replyInfoEmbed(interaction, locale, {
          titleKey: errorTitleKey,
          descriptionKey: errorDescriptionKey,
          descriptionVars,
          footerKey: "commands.generate.image.quota_exceeded_footer",
          tipKeys: await recoveryTips([], imageCreds.source),
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.novelai.generate.image.modal_title",
        components: [
          {
            customId: PROMPT_INPUT_ID,
            labelKey: "commands.novelai.generate.image.prompt_label",
            descriptionKey: "commands.novelai.generate.image.prompt_modal_description",
            placeholder: "commands.novelai.generate.image.prompt_placeholder",
            required: true,
            style: TextInputStyle.Paragraph,
            maxLength: 2000,
          },
          {
            customId: NEGATIVE_TAGS_INPUT_ID,
            labelKey: "commands.novelai.generate.image.negative_tags_label",
            descriptionKey: "commands.novelai.generate.image.negative_tags_modal_description",
            placeholder: "commands.novelai.generate.image.negative_tags_placeholder",
            required: false,
            style: TextInputStyle.Paragraph,
            maxLength: 1000,
          },
          {
            customId: CHARACTER_REFERENCE_INPUT_ID,
            labelKey: "commands.novelai.generate.image.character_reference_label",
            descriptionKey: "commands.novelai.generate.image.character_reference_modal_description",
            minValues: 0,
            maxValues: 1,
            required: false,
          },
          {
            kind: "radioGroup" as const,
            customId: ORIENTATION_SELECT_ID,
            labelKey: "commands.novelai.generate.image.orientation_label",
            descriptionKey: "commands.novelai.generate.image.orientation_modal_description",
            required: true,
            options: [
              {
                label: localizer(locale, "commands.novelai.generate.image.orientation_choice_portrait"),
                value: "portrait",
              },
              {
                label: localizer(locale, "commands.novelai.generate.image.orientation_choice_landscape"),
                value: "landscape",
              },
              {
                label: localizer(locale, "commands.novelai.generate.image.orientation_choice_square"),
                value: "square",
              },
            ],
          },
        ],
      },
      true,
    );

    if (modalResult.outcome !== "submit") {
      return;
    }

    modalSubmitInteraction = modalResult.interaction;
    const prompt = modalResult.values?.[PROMPT_INPUT_ID]?.trim();
    const negativeTagsInput = modalResult.values?.[NEGATIVE_TAGS_INPUT_ID]?.trim() ?? "";
    const orientation = modalResult.values?.[ORIENTATION_SELECT_ID];
    const characterReference = modalResult.attachments?.[CHARACTER_REFERENCE_INPUT_ID];

    if (!modalSubmitInteraction || !prompt || !orientation) {
      log.error("NovelAI generate image modal missing required values");
      return;
    }
    if (modelSelection) {
      imageCreds = await resolveSelectedNaiCredentials(tomoriState.server_id, userData.user_id ?? null, modelSelection);
      apiKey = imageCreds.apiKey;
      resolvedModel = await resolveNaiDiffusionModel({
        ...tomoriState.config,
        nai_diffusion_model_id: modelSelection.modelId,
      });
      if (resolvedModel?.diffusionModelId !== modelSelection.modelId) throw new GenerationModelUnavailableError();
    }
    submittedInput = {
      prompt,
      negativeTags: negativeTagsInput,
      orientation,
      referenceFilenames: characterReference ? [characterReference.filename] : [],
    };

    if (characterReference && !supportsNaiPreciseReference(resolvedModel.codename)) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.novelai.generate.image.character_reference_requires_v4_title",
        descriptionKey: "commands.novelai.generate.image.character_reference_requires_v4_description",
        descriptionVars: {
          model: resolvedModel.codename,
        },
        color: ColorCode.ERROR,
        ...recoveryOptions(),
      });
      return;
    }

    const negativePromptParts =
      (tomoriState.config.image_default_negative_tags?.length ?? 0) > 0
        ? [...(tomoriState.config.image_default_negative_tags ?? [])]
        : [NAI_DEFAULT_NEGATIVE_PROMPT];
    const userNegativeTags = splitTags(negativeTagsInput);
    negativePromptParts.push(...userNegativeTags);
    const effectiveNegativePrompt = negativePromptParts.join(", ");
    const positivePromptParts = [...(tomoriState.config.image_default_positive_tags ?? []), ...splitTags(prompt)];
    const effectivePrompt = positivePromptParts.join(", ");

    let characterPayload: NaiGenerationCharacterPayload | undefined;
    if (characterReference) {
      try {
        characterPayload = await prepareCharacterReferencePayload(characterReference);
      } catch (error) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.novelai.generate.image.invalid_reference_title",
          descriptionKey: "commands.novelai.generate.image.invalid_reference_description",
          color: ColorCode.ERROR,
          ...recoveryOptions(),
        });
        log.warn("[NAI] Invalid character reference attachment for slash command", error as Error);
        return;
      }
    }

    const startTime = performance.now();

    log.info(
      `[NAI] Slash command generation with model "${resolvedModel.codename}" (orientation: ${orientation}, hasRef: ${characterPayload?.referenceImages?.length ?? 0})`,
    );

    const imageBuffer = await generateNovelAiImage({
      apiKey,
      model: resolvedModel.codename,
      prompt: effectivePrompt,
      negativePrompt: effectiveNegativePrompt,
      orientation,
      imageParams: effectiveImageParams,
      characterPayload,
    });

    const generationTimeSeconds = ((performance.now() - startTime) / 1000).toFixed(1);
    const preparedImage = await prepareGeneratedImage(
      imageBuffer,
      effectivePrompt,
      locale,
      effectiveNegativePrompt,
      modalSubmitInteraction.attachmentSizeLimit,
    );
    if (imageCreds.source === "server") {
      await incrementImageQuota(tomoriState.server_id, interaction.user.id);
    }
    // Record canonical generation telemetry; quota tables enforce limits only.
    if (userData.user_id) {
      statRepository.recordStat({
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        lineageId: tomoriState.persona_lineage_id ?? 0,
        metric: "image_generated",
        metricKey: resolvedModel.codename,
      });
    }

    const filename = `nai_generated_${Date.now()}.${preparedImage.extension}`;
    const attachment = new AttachmentBuilder(preparedImage.buffer, {
      name: filename,
    }).setSpoiler(spoiler);

    const successEmbed = new EmbedBuilder()
      .setTitle(localizedStatusTitle(locale, "commands.novelai.generate.image.success_title", ColorCode.SUCCESS))
      .setColor(ColorCode.SUCCESS)
      .setFooter({
        text: localizer(
          locale,
          preparedImage.promptAttachment
            ? "commands.generate.image.prompt_attached_footer"
            : "commands.generate.image.prompt_embedded_footer",
        ),
      })
      .addFields([
        {
          name: localizer(locale, "commands.novelai.generate.image.field_model"),
          value: resolvedModel.codename,
          inline: true,
        },
        {
          name: localizer(locale, "commands.novelai.generate.image.field_generation_time"),
          value: `${generationTimeSeconds}s`,
          inline: true,
        },
        {
          name: localizer(locale, "commands.novelai.generate.image.field_orientation"),
          value: orientation,
          inline: true,
        },
      ]);

    if (!spoiler) successEmbed.setImage(`attachment://${filename}`);

    if (characterReference?.url && !spoiler) {
      successEmbed.setThumbnail(characterReference.url);
    }

    await modalSubmitInteraction.editReply({
      embeds: [successEmbed],
      files: preparedImage.promptAttachment ? [attachment, preparedImage.promptAttachment] : [attachment],
    });
  } catch (error) {
    if (error instanceof GenerationModelUnavailableError) {
      await replyGenerationModelUnavailable(modalSubmitInteraction ?? interaction, locale);
      return;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorKind = classifyNaiImageError(error);
    await reportProviderFailure({
      summary: "Error in /novelai generate image command",
      errorType: "CommandExecutionError",
      error,
      expected: errorKind !== "other",
      serverId: tomoriState?.server_id ?? null,
      userId: userData.user_id ?? null,
      dimensions: { operation: "image-generation", provider: "novelai", errorKind },
      metadata: {
        command: "novelai generate image",
        guildId: interaction.guild?.id ?? null,
        userDiscId: interaction.user.id,
        model: resolvedModel?.codename ?? null,
      },
    });

    const replyTarget = modalSubmitInteraction ?? interaction;
    const isPersonalNai = imageCreds?.source === "personal";
    const credentialSource = imageCreds?.source ?? "server";

    if (errorKind === "quota") {
      const tipKeys = await recoveryTips(
        isPersonalNai
          ? ["genai.tips.top_up_provider_balance", "genai.tips.disable_personal_text_override"]
          : ["genai.tips.wait_and_retry"],
        credentialSource,
      );
      await replyInfoEmbed(replyTarget, locale, {
        titleKey: "commands.novelai.generate.image.quota_error_title",
        descriptionKey: "commands.novelai.generate.image.quota_error_description",
        color: ColorCode.ERROR,
        tipKeys,
        ...recoveryOptions(),
      });
      return;
    }

    if (errorKind === "auth") {
      const tipKeys = await recoveryTips(
        isPersonalNai ? ["genai.tips.verify_api_key_personal"] : ["genai.tips.verify_api_key"],
        credentialSource,
      );
      await replyInfoEmbed(replyTarget, locale, {
        titleKey: "commands.novelai.generate.image.auth_error_title",
        descriptionKey: "commands.novelai.generate.image.auth_error_description",
        color: ColorCode.ERROR,
        tipKeys,
        ...recoveryOptions(),
      });
      return;
    }

    if (errorKind === "rate_limit") {
      await replyInfoEmbed(replyTarget, locale, {
        titleKey: "commands.novelai.generate.image.rate_limit_error_title",
        descriptionKey: "commands.novelai.generate.image.rate_limit_error_description",
        color: ColorCode.ERROR,
        tipKeys: await recoveryTips(["genai.tips.wait_and_retry"], credentialSource),
        ...recoveryOptions(),
      });
      return;
    }

    const tipKeys = await recoveryTips(
      isPersonalNai ? ["genai.tips.disable_personal_text_override"] : ["genai.tips.wait_and_retry"],
      credentialSource,
    );
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "commands.novelai.generate.image.error_title",
      descriptionKey: "commands.novelai.generate.image.error_description",
      descriptionVars: {
        error: errorMessage,
      },
      color: ColorCode.ERROR,
      tipKeys,
      ...recoveryOptions(),
    });
  }
}
