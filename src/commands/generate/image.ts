/**
 * Image Generation Command
 * Allows users to generate AI images using the configured provider
 * Supports text-to-image and image-to-image generation with up to 3 reference images
 * (Discord modal limit: 5 components total)
 */

import {
  MessageFlags,
  TextInputStyle,
  EmbedBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
  type APIAttachment,
} from "discord.js";
import { GoogleGenAI } from "@google/genai";
import { log, ColorCode } from "../../utils/misc/logger";
import { localizer } from "../../utils/text/localizer";
import { personaRepository, llmModelRepo } from "@/utils/db/repositories";
import { replyInfoEmbed, promptWithRawModal } from "../../utils/discord/interactionHelper";
import type { UserRow } from "../../types/db/schema";
import { checkImageQuota, incrementImageQuota } from "../../utils/quota/imageQuotaManager";
import { resolveProviderFeatureImplementation } from "@/utils/provider/providerInfoRegistry";
import { resolveNativeImageGenerationCapability } from "@/utils/provider/providerCapabilityResolver";
import { ZAI_CODING_IMAGES_GENERATIONS_URL, ZAI_GENERAL_IMAGES_GENERATIONS_URL } from "@/providers/zai/zaiShared";
import { generateCustomImageViaEndpoint } from "@/providers/custom/customEndpointDispatcher";
import {
  CredentialUnavailableError,
  PersonalProviderRequiredError,
  getResolvedCapabilityModelId,
  resolveCapabilityCredentials,
} from "@/utils/provider/credentialResolver";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import { formatCustomEndpointModelDisplay } from "@/utils/provider/customProviderUtils";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";

// Modal configuration constants
const MODAL_CUSTOM_ID = "generate_image_modal";
const PROMPT_INPUT_ID = "prompt_input";
const ASPECT_RATIO_SELECT_ID = "aspect_ratio_select";
const REFERENCE_IMAGE_INPUT_IDS = ["image_upload_1", "image_upload_2", "image_upload_3"] as const;

/**
 * Configure the subcommand
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("image").setDescription(localizer("en-US", "commands.generate.image.description"));

/**
 * Get the diffusion model codename from the database
 * @param diffusionModelId - Database ID of the diffusion model
 * @returns The model codename string (e.g., "gemini-2.5-flash-image")
 */
async function getDiffusionModelCodename(diffusionModelId: number): Promise<string> {
  const model = await llmModelRepo.loadDiffusionModelById(diffusionModelId);

  if (!model) {
    throw new Error(`Diffusion model not found: ${diffusionModelId}`);
  }

  return model.codename;
}

/**
 * Convert a Discord attachment to base64 format for image generation API
 * @param attachment - Discord API attachment object
 * @returns Object with mimeType and base64 data
 */
async function convertAttachmentToBase64(attachment: APIAttachment): Promise<{ mimeType: string; data: string }> {
  // 1. Validate image MIME type
  if (!attachment.content_type?.startsWith("image/")) {
    throw new Error(`Invalid image type: ${attachment.content_type}`);
  }

  // 2. Fetch image from Discord CDN with bounded download checks
  const downloadResult = await safeDownload(attachment.url, {
    maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
    timeoutMs: 10_000,
    knownSize: attachment.size,
  });
  if (!downloadResult.success || !downloadResult.buffer) {
    throw new Error(`Failed to fetch image: ${downloadResult.details ?? downloadResult.error ?? "unknown error"}`);
  }

  // 3. Convert to base64
  const base64Data = downloadResult.buffer.toString("base64");

  log.info(`Converted attachment ${attachment.id} (${attachment.filename}) to base64`);

  return {
    mimeType: attachment.content_type,
    data: base64Data,
  };
}

/**
 * Generate image using OpenRouter API
 * @param apiKey - Decrypted API key
 * @param modelCodename - Model codename (e.g., "google/gemini-2.5-flash-image")
 * @param prompt - Text prompt for image generation
 * @param aspectRatio - Aspect ratio (e.g., "16:9")
 * @param referenceImages - Optional array of reference images for img2img
 * @returns Promise resolving to generated image data and mimeType
 */
async function generateImageWithOpenRouter(
  apiKey: string,
  modelCodename: string,
  prompt: string,
  aspectRatio: string,
  referenceImages?: Array<{ mimeType: string; data: string }>,
): Promise<{ imageData: string | null; mimeType: string | null }> {
  log.info(
    `[OpenRouter] Sending image request to model "${modelCodename}" (aspect ratio: ${aspectRatio}, refs: ${referenceImages?.length ?? 0})`,
  );

  // Build content array with text prompt first (OpenRouter recommendation)
  const contentParts: Array<{
    type: string;
    text?: string;
    image_url?: { url: string };
  }> = [{ type: "text", text: prompt }];

  // Add reference images if provided (for img2img)
  if (referenceImages && referenceImages.length > 0) {
    for (const img of referenceImages) {
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${img.mimeType};base64,${img.data}`,
        },
      });
    }
    log.info(`[OpenRouter] Added ${referenceImages.length} reference image(s) to content array`);
  }

  // Prepare request payload
  const requestPayload = {
    model: modelCodename,
    messages: [
      {
        role: "user",
        content: contentParts,
      },
    ],
    modalities: ["image", "text"],
    image_config: {
      aspect_ratio: aspectRatio,
    },
  };

  // Call OpenRouter API
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const bodySnippet = errorText.slice(0, 500);

    // Try to extract human-readable message
    let parsedMessage = "";
    try {
      const parsed = JSON.parse(errorText);
      parsedMessage = (parsed?.error?.message as string | undefined) || (parsed?.message as string | undefined) || "";
    } catch {
      // Ignore JSON parse errors
    }

    const friendlyMessage = parsedMessage || bodySnippet || `${response.status} ${response.statusText}`.trim();

    throw new Error(`OpenRouter API request failed (${response.status} ${response.statusText}): ${friendlyMessage}`);
  }

  const result = await response.json();

  // Extract image from response.
  // OpenRouter may return images either in `message.images` or embedded in `message.content` parts.
  const message = result.choices?.[0]?.message;

  let imageUrl: string | null = null;

  if (message?.images?.[0]) {
    const firstImage = message.images[0];
    // OpenRouter may return either snake_case (image_url) or camelCase (imageUrl)
    imageUrl = firstImage?.image_url?.url || firstImage?.imageUrl?.url || null;
  } else if (Array.isArray(message?.content)) {
    const firstImagePart = message.content.find(
      (part: unknown) =>
        typeof part === "object" && part !== null && "type" in part && (part as { type?: string }).type === "image_url",
    ) as { image_url?: { url?: string } } | undefined;

    imageUrl = firstImagePart?.image_url?.url || null;
  }

  if (imageUrl) {
    // OpenRouter may return data URLs like "data:image/png;base64,..." OR a normal URL.
    const dataUrlMatches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUrlMatches) {
      return {
        imageData: dataUrlMatches[2],
        mimeType: dataUrlMatches[1],
      };
    }

    // Fallback: fetch remote URL and convert to base64.
    if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
      const imageResponse = await safeDownload(imageUrl, {
        maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
        timeoutMs: 15_000,
      });
      if (imageResponse.success && imageResponse.buffer) {
        const mimeType = imageResponse.contentType?.split(";")[0] || null;
        return {
          imageData: imageResponse.buffer.toString("base64"),
          mimeType,
        };
      }
    }
  }

  return { imageData: null, mimeType: null };
}

/**
 * Execute the image generation command
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param _userData - User data from database
 * @param locale - User's locale
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Ensure command is run in a channel context
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Load TomoriState for this server/user
  const serverId = interaction.guild?.id ?? interaction.user.id;
  const baseTomoriState = await personaRepository.loadState(serverId);

  // 3. Validate TomoriState exists
  if (!baseTomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { tomoriState } = await applyPersonalProviderSelectionsToTomoriState(baseTomoriState, userData.user_id ?? null);

  // 4. Check if image generation is enabled for this server
  if (!tomoriState.config.imagegen_enabled) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.generate.image.disabled_title",
      descriptionKey: "commands.generate.image.disabled_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 5. Resolve active image capability credentials and model selection
  let imageCreds: Awaited<ReturnType<typeof resolveCapabilityCredentials>>;
  try {
    imageCreds = await resolveCapabilityCredentials(tomoriState.server_id, "image-standard", {
      userId: userData.user_id ?? null,
    });
  } catch (error) {
    if (error instanceof PersonalProviderRequiredError) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.personal_provider_required_title",
        descriptionKey: "general.errors.personal_provider_required_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (error instanceof CredentialUnavailableError) {
      if (error.source === "personal") {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.personal_provider_credentials_error_title",
          descriptionKey: "general.errors.personal_provider_credentials_error_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (error.reason === "missing_model_id") {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.generate.image.no_diffusion_model_title",
          descriptionKey: "commands.generate.image.no_diffusion_model_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.generate.image.no_api_key_title",
        descriptionKey: "commands.generate.image.no_api_key_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    throw error;
  }

  const diffusionModelId =
    getResolvedCapabilityModelId(imageCreds, "image-standard") ?? tomoriState.config.diffusion_model_id;
  if (!diffusionModelId) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.generate.image.no_diffusion_model_title",
      descriptionKey: "commands.generate.image.no_diffusion_model_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const apiKey = imageCreds.apiKey;
  const executionProvider = imageCreds.provider;

  // 9. Check image generation quota BEFORE showing modal (prevent user frustration)
  const quotaCheck = await checkImageQuota(tomoriState.server_id, interaction.user.id);

  if (!quotaCheck.allowed) {
    // Build user-friendly error message based on quota type
    const errorTitleKey = "commands.generate.image.quota_exceeded_title";
    let errorDescriptionKey = "commands.generate.image.quota_exceeded_description";
    const descriptionVars: Record<string, string> = {};

    if (quotaCheck.resetTime) {
      const now = new Date();
      const resetTime = quotaCheck.resetTime;
      const hoursUntilReset = Math.ceil((resetTime.getTime() - now.getTime()) / (1000 * 60 * 60));

      if (hoursUntilReset < 24) {
        descriptionVars.reset_info = localizer(locale, "commands.generate.image.quota_resets_in_hours", {
          hours: hoursUntilReset.toString(),
        });
      } else {
        const daysUntilReset = Math.ceil(hoursUntilReset / 24);
        descriptionVars.reset_info = localizer(locale, "commands.generate.image.quota_resets_in_days", {
          days: daysUntilReset.toString(),
        });
      }
    }

    if (quotaCheck.reason === "user_quota_exceeded") {
      errorDescriptionKey = "commands.generate.image.user_quota_exceeded_description";
    } else if (quotaCheck.reason === "serverwide_quota_exceeded") {
      errorDescriptionKey = "commands.generate.image.serverwide_quota_exceeded_description";
    }

    await replyInfoEmbed(interaction, locale, {
      titleKey: errorTitleKey,
      descriptionKey: errorDescriptionKey,
      descriptionVars,
      footerKey: "commands.generate.image.quota_exceeded_footer",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Track modal submit interaction for error handling in catch block
  let modalSubmitInteraction: import("discord.js").ModalSubmitInteraction | undefined;

  try {
    // 9. Build modal components
    const modalComponents = [
      {
        customId: PROMPT_INPUT_ID,
        labelKey: "commands.generate.image.modal.prompt_label",
        descriptionKey: "commands.generate.image.modal.prompt_description",
        placeholder: "commands.generate.image.modal.prompt_placeholder",
        required: true,
        style: TextInputStyle.Paragraph,
        maxLength: 2000,
      },
      {
        customId: REFERENCE_IMAGE_INPUT_IDS[0],
        labelKey: "commands.generate.image.modal.image_upload_label",
        descriptionKey: "commands.generate.image.modal.image_upload_description",
        minValues: 0,
        maxValues: 1,
        required: false,
      },
      {
        customId: REFERENCE_IMAGE_INPUT_IDS[1],
        labelKey: "commands.generate.image.modal.image_upload_2_label",
        descriptionKey: "commands.generate.image.modal.image_upload_description",
        minValues: 0,
        maxValues: 1,
        required: false,
      },
      {
        customId: REFERENCE_IMAGE_INPUT_IDS[2],
        labelKey: "commands.generate.image.modal.image_upload_3_label",
        descriptionKey: "commands.generate.image.modal.image_upload_description",
        minValues: 0,
        maxValues: 1,
        required: false,
      },
      {
        kind: "radioGroup" as const,
        customId: ASPECT_RATIO_SELECT_ID,
        labelKey: "commands.generate.image.modal.aspect_ratio_label",
        descriptionKey: "commands.generate.image.modal.aspect_ratio_description",
        required: true,
        options: [
          { label: "1:1 (Square)", value: "1:1" },
          { label: "2:3 (Portrait)", value: "2:3" },
          { label: "3:2 (Landscape)", value: "3:2" },
          { label: "3:4 (Portrait)", value: "3:4" },
          { label: "4:3 (Landscape)", value: "4:3" },
          { label: "4:5 (Portrait)", value: "4:5" },
          { label: "5:4 (Landscape)", value: "5:4" },
          { label: "9:16 (Mobile Portrait)", value: "9:16" },
          { label: "16:9 (Widescreen)", value: "16:9" },
          { label: "21:9 (Ultra-wide)", value: "21:9" },
        ],
      },
    ];

    // 10. Show modal and wait for submission
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.generate.image.modal.title",
        components: modalComponents,
      },
      true, // Auto-defer with public reply
    );

    // 11. Handle modal outcome
    if (modalResult.outcome !== "submit") {
      log.info(`Generate image modal ${modalResult.outcome}`);
      return;
    }

    modalSubmitInteraction = modalResult.interaction;
    const prompt = modalResult.values?.[PROMPT_INPUT_ID];
    const aspectRatio = modalResult.values?.[ASPECT_RATIO_SELECT_ID];
    const imageAttachments = REFERENCE_IMAGE_INPUT_IDS.map((customId) => modalResult.attachments?.[customId]).filter(
      (attachment): attachment is APIAttachment => Boolean(attachment),
    );

    // 12. Safety check for required values
    if (!modalSubmitInteraction || !prompt || !aspectRatio) {
      log.error("Modal result unexpectedly missing required values");
      return;
    }

    // 13. Process reference image(s) (if provided)
    const referenceImages: Array<{ mimeType: string; data: string }> = [];
    let referenceImageUrl: string | undefined;

    for (const imageAttachment of imageAttachments) {
      try {
        log.info(`Processing uploaded reference image: ${imageAttachment.filename}`);
        const converted = await convertAttachmentToBase64(imageAttachment);
        referenceImages.push(converted);
        if (!referenceImageUrl) {
          referenceImageUrl = imageAttachment.url; // Use first reference for thumbnail
        }
      } catch (error) {
        log.warn(`Failed to process attachment ${imageAttachment.id}:`, error as Error);

        // Image processing failed - show error and exit
        await modalSubmitInteraction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.generate.image.invalid_image_title"))
              .setDescription(localizer(locale, "commands.generate.image.invalid_image_description"))
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }
    }

    if (referenceImages.length > 0) {
      log.info(`Successfully processed ${referenceImages.length} reference image(s)`);
    }

    // 14. Get model codename from database
    const modelCodename = await getDiffusionModelCodename(diffusionModelId);
    const displayModelName = imageCreds.customEndpoint
      ? formatCustomEndpointModelDisplay(imageCreds.customEndpoint)
      : modelCodename;

    log.info(
      `Generating image with ${executionProvider} via ${displayModelName}: "${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}" (aspect ratio: ${aspectRatio}, references: ${referenceImages.length})`,
    );

    // 15. Start timer for generation time tracking
    const startTime = performance.now();

    // 16. Call provider API to generate image
    let generatedImageData: string | null = null;
    let generatedImageMimeType: string | null = null;
    const imageGenerationImplementation = resolveProviderFeatureImplementation(executionProvider, "imageGeneration");
    const nativeImageProvider =
      executionProvider === "vertex" || executionProvider === "vertexexpress"
        ? await resolveNativeImageGenerationCapability(executionProvider)
        : null;

    if (imageCreds.customEndpoint) {
      const result = await generateCustomImageViaEndpoint({
        endpoint: imageCreds.customEndpoint,
        apiKey,
        prompt,
        aspectRatio,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      });
      generatedImageData = result.imageData;
      generatedImageMimeType = result.mimeType;
    } else if (nativeImageProvider) {
      const result = await nativeImageProvider.generateNativeImage({
        apiKey,
        model: modelCodename,
        prompt,
        aspectRatio,
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
      });
      generatedImageData = result.imageData;
      generatedImageMimeType = result.mimeType;
    } else if (imageGenerationImplementation === "openrouter") {
      // Use OpenRouter API
      const result = await generateImageWithOpenRouter(
        apiKey,
        modelCodename,
        prompt,
        aspectRatio,
        referenceImages.length > 0 ? referenceImages : undefined,
      );
      generatedImageData = result.imageData;
      generatedImageMimeType = result.mimeType;
    } else if (imageGenerationImplementation === "google") {
      // Use Google Gemini API
      const ai = new GoogleGenAI({ apiKey });
      const chat = ai.chats.create({
        model: modelCodename,
      });

      // Build parts: reference images (as inlineData) followed by the text prompt.
      // SendMessageParameters.message is PartListUnion — inline images must be
      // passed as inlineData parts, not via a non-existent "media" field.
      const messageParts: Array<{ inlineData: { mimeType: string; data: string } } | string> = [
        ...referenceImages.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
        prompt,
      ];

      const response = await chat.sendMessage({
        message: messageParts,
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: aspectRatio,
          },
        },
      });

      // Extract generated image from response
      if (response?.candidates && response.candidates.length > 0 && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            generatedImageData = part.inlineData.data ?? null;
            generatedImageMimeType = part.inlineData.mimeType ?? null;
            break;
          }
        }
      }
    } else if (imageGenerationImplementation === "zai") {
      // Use Z.ai native image generation API
      if (referenceImages.length > 0) {
        await interaction.followUp({
          content: localizer(locale, "commands.generate.image.zai_no_img2img_warning"),
        });
      }
      const { generateZaiNativeImage } = await import("@/providers/zai/zaiImageGeneration");
      const result = await generateZaiNativeImage({
        apiKey,
        model: modelCodename,
        prompt,
        aspectRatio,
        endpointUrl:
          executionProvider === "zaicoding" ? ZAI_CODING_IMAGES_GENERATIONS_URL : ZAI_GENERAL_IMAGES_GENERATIONS_URL,
      });
      generatedImageData = result.imageData;
      generatedImageMimeType = result.mimeType;
    } else if (imageGenerationImplementation === "nvidia") {
      // Use NVIDIA native image generation API
      if (referenceImages.length > 0) {
        await interaction.followUp({
          content: localizer(locale, "commands.generate.image.nvidia_no_img2img_warning"),
        });
      }
      const { generateNvidiaNativeImage } = await import("@/providers/nvidia/nvidiaImageGeneration");
      const result = await generateNvidiaNativeImage({
        apiKey,
        model: modelCodename,
        prompt,
        aspectRatio,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      });
      generatedImageData = result.imageData;
      generatedImageMimeType = result.mimeType;
    } else {
      throw new Error(`Image generation is not implemented for provider ${executionProvider}`);
    }

    // 17. Calculate generation time
    const endTime = performance.now();
    const generationTimeSeconds = ((endTime - startTime) / 1000).toFixed(1);

    // 18. Validate image was generated
    if (!generatedImageData) {
      await modalSubmitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.generate.image.error_generation_failed_title"))
            .setDescription(
              localizer(locale, "commands.generate.image.error_generation_failed_description", {
                error: "No image data received from API",
              }),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // 19. Convert base64 to buffer and create attachment
    const imageBuffer = Buffer.from(generatedImageData, "base64");

    // Determine file extension from MIME type
    const extension =
      generatedImageMimeType === "image/jpeg" ? "jpg" : generatedImageMimeType === "image/webp" ? "webp" : "png"; // Default to PNG

    const filename = `generated_${Date.now()}.${extension}`;
    const attachment = new AttachmentBuilder(imageBuffer, { name: filename });

    // 19.5. Increment quota after successful generation
    await incrementImageQuota(tomoriState.server_id, interaction.user.id);

    // 20. Build success embed
    const successEmbed = new EmbedBuilder()
      .setTitle(localizer(locale, "commands.generate.image.success_title"))
      .setColor(ColorCode.SUCCESS)
      .setImage(`attachment://${filename}`)
      .addFields([
        {
          name: localizer(locale, "commands.generate.image.field_prompt"),
          value: prompt.substring(0, 1024), // Discord limit
          inline: false,
        },
        {
          name: localizer(locale, "commands.generate.image.field_model"),
          value: displayModelName,
          inline: true,
        },
        {
          name: localizer(locale, "commands.generate.image.field_generation_time"),
          value: `${generationTimeSeconds}s`,
          inline: true,
        },
        {
          name: localizer(locale, "commands.generate.image.field_aspect_ratio"),
          value: aspectRatio,
          inline: true,
        },
      ]);

    // Set reference image as thumbnail if provided
    if (referenceImageUrl) {
      successEmbed.setThumbnail(referenceImageUrl);
    }

    // 21. Send success embed with generated image
    await modalSubmitInteraction.editReply({
      embeds: [successEmbed],
      files: [attachment],
    });

    log.success(`Successfully generated and sent image (${generationTimeSeconds}s)`);
  } catch (error) {
    // Handle errors
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error("Image generation failed:", error as Error);

    // Use modalSubmitInteraction if available (error after modal), otherwise interaction (error during modal)
    const replyTarget = modalSubmitInteraction ?? interaction;

    // Check for billing/payment errors
    if (
      errorMessage.includes("billing") ||
      errorMessage.includes("payment") ||
      errorMessage.includes("quota") ||
      errorMessage.includes("PERMISSION_DENIED")
    ) {
      await replyInfoEmbed(replyTarget, locale, {
        titleKey: "commands.generate.image.error_billing_title",
        descriptionKey: "commands.generate.image.error_billing_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check for content safety errors
    if (errorMessage.includes("safety") || errorMessage.includes("blocked") || errorMessage.includes("RECITATION")) {
      await replyInfoEmbed(replyTarget, locale, {
        titleKey: "commands.generate.image.error_safety_title",
        descriptionKey: "commands.generate.image.error_safety_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Generic error fallback
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "commands.generate.image.error_generation_failed_title",
      descriptionKey: "commands.generate.image.error_generation_failed_description",
      descriptionVars: { error: errorMessage },
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
