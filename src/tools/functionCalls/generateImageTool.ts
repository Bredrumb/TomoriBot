/**
 * Image Generation Tool
 * Allows TomoriBot to generate images using the active provider's native image API
 * Supports text-to-image, and image-to-image only when the active provider supports it
 */

import { AttachmentBuilder } from "discord.js";
import { GoogleGenAI } from "@google/genai";
import { log, ColorCode } from "../../utils/misc/logger";
import { localizer } from "../../utils/text/localizer";
import { resolveAvatarByIdentity } from "@/utils/discord/avatarResolver";
import { sendWebhookMessageWithIdentity } from "@/utils/discord/webhookManager";
import {
  buildImageToolNoticeDescription,
  buildReferencedMessageUrl,
  sendToolProgressNotice,
} from "@/utils/discord/toolProgressNotice";
import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "../../types/tool/interfaces";
import { sql } from "../../utils/db/client";
import { checkImageQuota, incrementImageQuota } from "../../utils/quota/imageQuotaManager";
import { resolveProviderFeatureImplementation } from "@/utils/provider/providerInfoRegistry";
import { resolveNativeImageGenerationCapability } from "@/utils/provider/providerCapabilityResolver";
import { generateCustomImageViaEndpoint } from "@/providers/custom/customEndpointDispatcher";
import { ZAI_CODING_IMAGES_GENERATIONS_URL, ZAI_GENERAL_IMAGES_GENERATIONS_URL } from "@/providers/zai/zaiShared";
import { getResolvedCapabilityModelId, resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { formatCustomEndpointModelDisplay } from "@/utils/provider/customProviderUtils";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";

/**
 * Tool for generating images using the active provider's native image API
 */
export class GenerateImageTool extends BaseTool {
  name = "generate_image";
  description =
    "Generate an AI image using the active provider's native image model. Use this only when the user explicitly asks you to make, draw, generate, create, edit, or continue an image; do not call it for casual visual discussion. If the user asks you to make/draw/generate an image and this tool is available, call this tool instead of only describing the image. Provide a detailed text prompt describing what image you want to create. If you provide a media_id or target_identity reference, focus the prompt on edits or additions only and avoid re-describing the reference image. You can also specify an aspect ratio (default is 1:1). After generating, the image will be sent directly to the Discord channel.";
  category = "utility" as const;
  requiresFeatureFlag = "image_gen";

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "A detailed text description of the image you want to generate. Be specific about style, composition, colors, mood, and any important details. For image-to-image, describe only the modifications or additions you want and avoid re-describing the reference image.",
      },
      media_id: {
        type: "string",
        description:
          "Optional: The media reference ID (e.g., media_1) from the system hint for the message containing images to use as reference for image-to-image generation. The tool will extract all images from this message and use them to guide the generation along with your prompt. If not provided, generates a new image from scratch (text-to-image).",
      },
      target_identity: {
        type: "string",
        description:
          "Optional: User or persona identity whose profile picture/avatar should be used as a reference image. Accepts 'self', an exact persona nickname, or a natural user name from the current conversation or server. Deprecated raw IDs are still accepted at execution time for compatibility. Can be combined with media_id references.",
      },
      aspect_ratio: {
        type: "string",
        description: "Optional: The aspect ratio for the generated image. Default is '1:1' (square).",
        enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
      },
    },
    required: ["prompt"],
  };

  /**
   * Standard image generation is available for any tool-capable chat model.
   * The actual execution provider is resolved from the configured image slot.
   * @param _provider - LLM provider name
   * @returns Always true — actual availability is gated by config + credential resolution
   */
  isAvailableFor(_provider: string): boolean {
    return true;
  }

  /**
   * Hide the tool unless a standard image slot is configured for the active state.
   */
  isAvailableForContext(_provider: string, context?: ToolContext): boolean {
    return (context?.tomoriState.config.diffusion_model_id ?? null) !== null;
  }

  /**
   * Check if image generation is enabled in Tomori config
   * @param context - Tool execution context
   * @returns True if image generation is enabled
   */
  protected isEnabled(context: ToolContext): boolean {
    return context.tomoriState.config.imagegen_enabled;
  }

  /**
   * Get the diffusion model codename from the database
   * @param diffusionModelId - Database ID of the diffusion model
   * @returns The model codename string (e.g., "gemini-2.5-flash-image")
   */
  private async getDiffusionModelCodename(diffusionModelId: number): Promise<string> {
    const result = await sql`
			SELECT codename
			FROM image_diffusion_models
			WHERE diffusion_model_id = ${diffusionModelId}
		`.values();

    if (result.length === 0) {
      throw new Error(`Diffusion model not found in database: ${diffusionModelId}`);
    }

    return result[0][0] as string;
  }

  private async sendGeneratedImage(
    context: ToolContext,
    attachment: AttachmentBuilder,
  ): Promise<import("discord.js").Message> {
    const threadId =
      "isThread" in context.channel && typeof context.channel.isThread === "function" && context.channel.isThread()
        ? context.channel.id
        : undefined;

    if (context.webhook && context.personaUsername) {
      try {
        return await sendWebhookMessageWithIdentity(
          context.webhook,
          {
            files: [attachment],
            ...(threadId ? { threadId } : {}),
          },
          {
            username: context.personaUsername,
            avatarUrl: context.personaAvatarUrl,
            avatarDataUri: context.personaAvatarUrl?.startsWith("data:image/") ? context.personaAvatarUrl : undefined,
          },
        );
      } catch (error) {
        log.warn("Failed to send generated image via webhook, falling back to bot message", error as Error);
      }
    }

    return await context.channel.send({ files: [attachment] });
  }

  /**
   * Build Discord CDN URL for custom emoji
   * @param emojiId - Discord emoji ID
   * @returns CDN URL for the emoji as PNG
   */
  private buildEmojiCdnUrl(emojiId: string): string {
    // Always use PNG so animated emojis fall back to their first frame
    return `https://cdn.discordapp.com/emojis/${emojiId}.png`;
  }

  /**
   * Extract custom emoji URLs from message content
   * @param content - Message text content
   * @returns Array of image URLs for custom emojis found in the content
   */
  private extractCustomEmojis(content: string): Array<{
    url: string;
    mimeType: string;
    source: string;
  }> {
    const emojiUrls: Array<{ url: string; mimeType: string; source: string }> = [];
    if (!content) return emojiUrls;

    const emojiPattern = /<(a?):([^:]+):(\d{17,20})>/g;
    const seenEmojiIds = new Set<string>();
    let match: RegExpExecArray | null;

    // biome-ignore lint/suspicious/noAssignInExpressions: Separate match assignment from null check
    while ((match = emojiPattern.exec(content)) !== null) {
      const emojiName = match[2];
      const emojiId = match[3];

      if (seenEmojiIds.has(emojiId)) {
        continue;
      }

      seenEmojiIds.add(emojiId);
      const emojiUrl = this.buildEmojiCdnUrl(emojiId);

      emojiUrls.push({
        url: emojiUrl,
        mimeType: "image/png",
        source: `emoji: ${emojiName}`,
      });
    }

    return emojiUrls;
  }

  /**
   * Extract images from a Discord message and convert to base64 format
   * Supports both direct attachments and embedded images (from links like Twitter/X)
   * @param messageId - Discord message ID to fetch images from
   * @param context - Tool execution context with channel access
   * @returns Array of inline data objects with mimeType and base64 data
   */
  private async extractImagesFromMessage(
    messageId: string,
    context: ToolContext,
  ): Promise<Array<{ mimeType: string; data: string }>> {
    try {
      // 1. Fetch the Discord message
      const message = await context.channel.messages.fetch(messageId);

      if (!message) {
        throw new Error(`Message ${messageId} not found`);
      }

      // Array to collect all image URLs (from both attachments and embeds)
      const imageUrls: Array<{
        url: string;
        mimeType: string;
        source: string;
      }> = [];

      // 2. Extract images from direct attachments
      const imageAttachments = message.attachments.filter((attachment) => attachment.contentType?.startsWith("image/"));

      for (const attachment of imageAttachments.values()) {
        imageUrls.push({
          url: attachment.url,
          mimeType: attachment.contentType || "image/jpeg",
          source: `attachment: ${attachment.name}`,
        });
      }

      // 3. Extract images from embeds (Twitter/X posts, direct image links, etc.)
      for (const embed of message.embeds) {
        // Check for main embed image
        if (embed.image?.url) {
          imageUrls.push({
            url: embed.image.url,
            mimeType: "image/jpeg", // Embeds don't provide explicit MIME type
            source: `embed.image: ${embed.url || "unknown"}`,
          });
        }

        // Check for embed thumbnail (some embeds use thumbnail instead of image)
        if (embed.thumbnail?.url) {
          imageUrls.push({
            url: embed.thumbnail.url,
            mimeType: "image/jpeg",
            source: `embed.thumbnail: ${embed.url || "unknown"}`,
          });
        }
      }

      // 3.5. Extract images from Discord stickers
      if (message.stickers.size > 0) {
        for (const sticker of message.stickers.values()) {
          imageUrls.push({
            url: sticker.url,
            mimeType: "image/png", // Discord serves PNG version for stickers
            source: `sticker: ${sticker.name}`,
          });
        }
      }

      // 3.6. Extract custom emojis from message content
      if (message.content) {
        const customEmojis = this.extractCustomEmojis(message.content);
        imageUrls.push(...customEmojis);
      }

      // 4. Validate we found at least one image
      if (imageUrls.length === 0) {
        throw new Error(
          `No images found in message ${messageId} (checked attachments, embeds, stickers, and custom emojis)`,
        );
      }

      log.info(
        `Found ${imageUrls.length} image(s) in message ${messageId} (${imageAttachments.size} attachment(s), ${imageUrls.length - imageAttachments.size} embed(s))`,
      );

      // 5. Convert each image URL to base64
      const inlineDataArray: Array<{ mimeType: string; data: string }> = [];

      for (const imageInfo of imageUrls) {
        try {
          // Fetch image data
          const imageResponse = await safeDownload(imageInfo.url, {
            maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
            timeoutMs: 15_000,
          });
          if (!imageResponse.success || !imageResponse.buffer) {
            log.warn(`Failed to fetch image from ${imageInfo.source}: ${imageResponse.details ?? imageResponse.error}`);
            continue;
          }

          // Convert to base64
          const base64ImageData = imageResponse.buffer.toString("base64");

          inlineDataArray.push({
            mimeType: imageInfo.mimeType,
            data: base64ImageData,
          });

          log.info(`Successfully converted image from ${imageInfo.source} to base64`);
        } catch (imgErr) {
          log.warn(`Failed to process image from ${imageInfo.source}:`, imgErr as Error);
        }
      }

      // 6. Ensure at least one image was successfully processed
      if (inlineDataArray.length === 0) {
        throw new Error(`Failed to process any images from message ${messageId}`);
      }

      return inlineDataArray;
    } catch (error) {
      log.error(`Error extracting images from message ${messageId}:`, error);
      throw error;
    }
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
  private async generateImageWithOpenRouter(
    apiKey: string,
    modelCodename: string,
    prompt: string,
    aspectRatio: string,
    referenceImages?: Array<{ mimeType: string; data: string }>,
  ): Promise<{ imageData: string | null; mimeType: string | null }> {
    // Helpful debug log for provider/model combo
    log.info(
      `[OpenRouter] Sending image request to model "${modelCodename}" (aspect ratio: ${aspectRatio}, refs: ${referenceImages?.length ?? 0})`,
    );

    // Prepare messages array
    const messages: Array<{
      role: string;
      content: Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }>;
    }> = [];

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
      log.info(
        `[OpenRouter] Added ${referenceImages.length} reference image(s) to content array. Total content parts: ${contentParts.length}`,
      );
    }

    messages.push({
      role: "user",
      content: contentParts,
    });

    // Prepare request payload
    const requestPayload = {
      model: modelCodename,
      messages: messages,
      modalities: ["image", "text"],
      image_config: {
        aspect_ratio: aspectRatio,
      },
    };

    // Log request structure (without full base64 data to avoid log clutter)
    log.info(
      `[OpenRouter] Request payload structure: ${JSON.stringify(
        {
          model: requestPayload.model,
          messageCount: requestPayload.messages.length,
          message: {
            role: messages[0]?.role,
            contentParts: contentParts.map((part) => ({
              type: part.type,
              hasImageUrl: part.type === "image_url",
              hasText: part.type === "text",
              // Log first 100 chars of base64 to verify image data exists
              imageDataPreview: part.image_url?.url.substring(0, 100),
              textPreview: part.text?.substring(0, 50),
            })),
          },
          modalities: requestPayload.modalities,
          image_config: requestPayload.image_config,
        },
        null,
        2,
      )}`,
    );

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
      // Log richer context without dumping the whole prompt
      const bodySnippet = errorText.slice(0, 500);
      log.warn(
        `[OpenRouter] Image request failed (${response.status} ${response.statusText}) for model "${modelCodename}". Body: ${bodySnippet}`,
      );

      // Try to pull a human-readable message out of the body if possible
      let parsedMessage = "";
      try {
        const parsed = JSON.parse(errorText);
        parsedMessage = (parsed?.error?.message as string | undefined) || (parsed?.message as string | undefined) || "";
      } catch {
        // ignore JSON parse errors; fall back to raw snippet
      }

      const friendlyMessage = parsedMessage || bodySnippet || `${response.status} ${response.statusText}`.trim();

      throw new Error(
        `OpenRouter API request failed (${response.status} ${response.statusText}) for model "${modelCodename}": ${friendlyMessage}`,
      );
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
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as { type?: string }).type === "image_url",
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
   * Execute image generation
   * @param args - Arguments containing prompt, optional media_id, and optional aspect_ratio
   * @param context - Tool execution context
   * @returns Promise resolving to tool result with generated image
   */
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    // Validate parameters
    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
      };
    }

    // Check if tool is enabled
    if (!this.isEnabled(context)) {
      return {
        success: false,
        error: "Image generation is disabled for this server",
        message: "Image generation is not enabled for this server.",
      };
    }

    // Check image generation quota BEFORE generating
    const userDiscId = context.userId || context.message?.author.id || "";
    if (!userDiscId) {
      return {
        success: false,
        error: "Unable to identify user for quota checking",
      };
    }

    const quotaCheck = await checkImageQuota(context.tomoriState.server_id, userDiscId);

    if (!quotaCheck.allowed) {
      // Build user-friendly error message based on quota type
      let errorMessage = "";
      let resetInfo = "";

      if (quotaCheck.resetTime) {
        const now = new Date();
        const resetTime = quotaCheck.resetTime;
        const hoursUntilReset = Math.ceil((resetTime.getTime() - now.getTime()) / (1000 * 60 * 60));

        if (hoursUntilReset < 24) {
          resetInfo = localizer(context.locale, "tools.generate_image.quota_resets_in_hours", {
            hours: hoursUntilReset.toString(),
          });
        } else {
          const daysUntilReset = Math.ceil(hoursUntilReset / 24);
          resetInfo = localizer(context.locale, "tools.generate_image.quota_resets_in_days", {
            days: daysUntilReset.toString(),
          });
        }
      }

      if (quotaCheck.reason === "user_quota_exceeded") {
        errorMessage = localizer(context.locale, "tools.generate_image.user_quota_exceeded", { reset_info: resetInfo });
      } else if (quotaCheck.reason === "serverwide_quota_exceeded") {
        errorMessage = localizer(context.locale, "tools.generate_image.serverwide_quota_exceeded", {
          reset_info: resetInfo,
        });
      } else {
        errorMessage = localizer(context.locale, "tools.generate_image.quota_exceeded_generic");
      }

      return {
        success: false,
        error: "Image generation quota exceeded",
        message: errorMessage,
      };
    }

    // Extract arguments
    const prompt = args.prompt as string;
    const messageId = args.media_id as string | undefined;
    const targetIdentity = (args.target_identity as string | undefined) ?? (args.user_id as string | undefined);
    const aspectRatio = (args.aspect_ratio as string) || "1:1";
    const usesReferences = !!(messageId || targetIdentity);

    try {
      // Get the diffusion model codename from database
      const creds = await resolveCapabilityCredentials(context.tomoriState.server_id, "image-standard", {
        userId: context.internalUserId ?? null,
      });
      const diffusionModelId =
        getResolvedCapabilityModelId(creds, "image-standard") ?? context.tomoriState.config.diffusion_model_id;

      if (!diffusionModelId) {
        return {
          success: false,
          error:
            "No diffusion model configured for this server. Please run the setup command or configure an API key to enable image generation.",
        };
      }

      const modelCodename = await this.getDiffusionModelCodename(diffusionModelId);
      const displayModelName = creds.customEndpoint
        ? formatCustomEndpointModelDisplay(creds.customEndpoint)
        : modelCodename;

      log.info(`Using diffusion model: ${modelCodename} for image generation`);

      const apiKey = creds.apiKey;
      const executionProvider = creds.provider;

      if (!context.suppressProgressNotices) {
        const baseNoticeDescription = localizer(
          context.locale,
          usesReferences ? "genai.image.generating_with_references_description" : "genai.image.generating_description",
        );
        const referenceSourceCount = Number(messageId ? 1 : 0) + Number(targetIdentity ? 1 : 0);
        const referencedMessageUrl = messageId ? buildReferencedMessageUrl(context, messageId) : null;
        const extraNoticeLines: string[] = [];
        if (referencedMessageUrl) {
          extraNoticeLines.push(
            localizer(context.locale, "genai.image.notice_reference_line", {
              message_url: referencedMessageUrl,
            }),
          );
        }
        if (!referencedMessageUrl && referenceSourceCount) {
          extraNoticeLines.push(
            localizer(context.locale, "genai.image.notice_reference_count_line", {
              count: referenceSourceCount.toString(),
            }),
          );
        } else if (referencedMessageUrl && referenceSourceCount > 1) {
          extraNoticeLines.push(
            localizer(context.locale, "genai.image.notice_reference_count_line", {
              count: referenceSourceCount.toString(),
            }),
          );
        }
        await sendToolProgressNotice(
          context,
          "image_generation",
          {
            titleKey: "genai.image.generating_title",
            description: buildImageToolNoticeDescription(
              context.locale,
              baseNoticeDescription,
              displayModelName,
              prompt,
              localizer(context.locale, "genai.image.generating_footer"),
              extraNoticeLines,
            ),
            color: ColorCode.INFO,
          },
          "GenerateImageTool",
        );
      }

      // Collect reference images from message attachments and/or profile picture
      const referenceImages: Array<{ mimeType: string; data: string }> = [];

      if (messageId) {
        log.info(`Extracting images from message ${messageId} for image-to-image generation`);
        const messageImages = await this.extractImagesFromMessage(messageId, context);
        referenceImages.push(...messageImages);
        log.info(`Using ${messageImages.length} reference image(s) from message ${messageId} for generation`);
      }

      if (targetIdentity) {
        try {
          const avatarData = await resolveAvatarByIdentity(targetIdentity, context, {
            forceStatic: false,
          });
          const avatarBase64 = await this.fetchAndConvertImageToBase64(avatarData.avatarUrl);
          referenceImages.push({
            mimeType: "image/png",
            data: avatarBase64,
          });
          const avatarTypeLabel =
            avatarData.sourceType === "persona" ? "persona" : avatarData.sourceType === "webhook" ? "webhook" : "user";
          log.info(`Added profile picture reference for ${avatarTypeLabel} ${avatarData.username} (${targetIdentity})`);
        } catch (avatarErr) {
          log.error(`Failed to fetch profile picture for identity ${targetIdentity}`, avatarErr as Error);
          return {
            success: false,
            error: "Failed to fetch profile picture for target_identity",
            message:
              avatarErr instanceof Error
                ? avatarErr.message
                : "Could not fetch an avatar for that identity. Please confirm the name or persona and try again.",
          };
        }
      }

      // Call appropriate provider API
      log.info(
        `Generating image with ${executionProvider} via ${displayModelName}: "${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}" (aspect ratio: ${aspectRatio})`,
      );

      let generatedImageData: string | null = null;
      let referenceImagesUsed = referenceImages.length > 0;
      let referenceImagesIgnoredReason = "";
      const imageGenerationImplementation = resolveProviderFeatureImplementation(executionProvider, "imageGeneration");
      const nativeImageProvider =
        executionProvider === "vertex" || executionProvider === "vertexexpress"
          ? await resolveNativeImageGenerationCapability(executionProvider)
          : null;

      if (creds.customEndpoint) {
        const result = await generateCustomImageViaEndpoint({
          endpoint: creds.customEndpoint,
          apiKey,
          prompt,
          aspectRatio,
          referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        });
        generatedImageData = result.imageData;
      } else if (nativeImageProvider) {
        const result = await nativeImageProvider.generateNativeImage({
          apiKey,
          model: modelCodename,
          prompt,
          aspectRatio,
          ...(referenceImages.length > 0 ? { referenceImages } : {}),
        });
        generatedImageData = result.imageData;
      } else if (imageGenerationImplementation === "openrouter") {
        // Use OpenRouter API
        const result = await this.generateImageWithOpenRouter(
          apiKey,
          modelCodename,
          prompt,
          aspectRatio,
          referenceImages.length > 0 ? referenceImages : undefined,
        );
        generatedImageData = result.imageData;
      } else if (imageGenerationImplementation === "google") {
        // Use Google Gemini API
        const ai = new GoogleGenAI({ apiKey });
        const chat = ai.chats.create({
          model: modelCodename,
        });

        const messagePayload: {
          message: string;
          media?: Array<{ mimeType: string; data: string }>;
          config?: {
            responseModalities: string[];
            imageConfig: {
              aspectRatio: string;
            };
          };
        } = {
          message: prompt,
          config: {
            responseModalities: ["IMAGE"],
            imageConfig: {
              aspectRatio: aspectRatio,
            },
          },
        };

        if (referenceImages.length > 0) {
          messagePayload.media = referenceImages;
        }

        const response = await chat.sendMessage(messagePayload);

        // Extract generated image from response
        if (response?.candidates && response.candidates.length > 0 && response.candidates[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
              generatedImageData = part.inlineData.data ?? null;
              break;
            }
          }
        }
      } else if (imageGenerationImplementation === "zai") {
        // Use Z.ai native image generation API
        if (referenceImages.length > 0) {
          referenceImagesUsed = false;
          referenceImagesIgnoredReason =
            " Reference images were ignored because the active provider's image endpoint is text-to-image only.";
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
      } else if (imageGenerationImplementation === "nvidia") {
        // Use NVIDIA native image generation API
        if (referenceImages.length > 0) {
          referenceImagesUsed = false;
          referenceImagesIgnoredReason =
            " Reference images were ignored because the active provider's image endpoint is text-to-image only.";
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
      } else {
        return {
          success: false,
          error: `Image generation is not implemented for provider ${executionProvider}`,
        };
      }

      if (!generatedImageData) {
        return {
          success: false,
          error: "No image data received from API. The generation may have been blocked or failed.",
        };
      }

      // Convert base64 to buffer and send to Discord
      const imageBuffer = Buffer.from(generatedImageData, "base64");
      const attachment = new AttachmentBuilder(imageBuffer, {
        name: `generated_${Date.now()}.png`,
      });

      // Send image to Discord channel and capture the sent message for metadata
      const sentMessage = await this.sendGeneratedImage(context, attachment);

      log.success("Successfully generated and sent image to Discord");

      // Increment quota after successful generation
      await incrementImageQuota(context.tomoriState.server_id, userDiscId);

      // Note: We intentionally DO NOT include imageMetadata for generated images
      // because Discord CDN URLs are protected and cannot be fetched by external
      // servers (like OpenRouter). The model doesn't need to see its own generated
      // output - it just needs confirmation that the generation succeeded.
      // The text message includes the Discord message ID for reference.

      // Build success message with remaining quota info (if quota is enabled)
      let successMessage = `Successfully generated and sent image to Discord (message ID: ${sentMessage.id}). The image has been created based on your prompt${
        referenceImagesUsed ? " and the reference image(s)" : ""
      }.`;
      if (referenceImagesIgnoredReason) {
        successMessage += referenceImagesIgnoredReason;
      }

      if (quotaCheck.userRemaining !== undefined) {
        const remainingText = localizer(context.locale, "tools.generate_image.quota_remaining", {
          remaining: quotaCheck.userRemaining.toString(),
        });
        successMessage += ` ${remainingText}`;
      }

      return {
        success: true,
        message: successMessage,
        // imageMetadata intentionally omitted to avoid 403 errors when OpenRouter tries to fetch Discord CDN URLs
        // End the LLM turn immediately when this tool is the target of a hidden agent turn
        endTurn: context.streamContext?.endTurnAfterTools?.includes(this.name) ?? false,
      };
    } catch (error) {
      // Handle specific Google API errors
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Localize errors, but fall back to readable defaults if the localizer
      // isn't initialized or a key is missing (to avoid leaking locale keys)
      const getReadableError = (key: string, fallback: string): string => {
        const localized = localizer(context.locale, key);
        return localized === key ? fallback : localized;
      };

      log.error("Image generation failed:", error as Error);

      // Check for billing/payment errors
      if (
        errorMessage.includes("billing") ||
        errorMessage.includes("payment") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("PERMISSION_DENIED")
      ) {
        return {
          success: false,
          error: getReadableError("errors.google.400_billing_default_message", "Billing is required for this service"),
        };
      }

      // Check for content safety errors
      if (errorMessage.includes("safety") || errorMessage.includes("blocked") || errorMessage.includes("RECITATION")) {
        return {
          success: false,
          error: getReadableError(
            "genai.google.content_blocked_default_message",
            "Your content was blocked by safety filters",
          ),
        };
      }

      // Generic error fallback
      return {
        success: false,
        error: `Failed to generate image: ${errorMessage}`,
      };
    }
  }
  /**
   * Fetch an image URL and convert to base64 (used for profile pictures)
   */
  private async fetchAndConvertImageToBase64(imageUrl: string): Promise<string> {
    const response = await safeDownload(imageUrl, {
      maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
      timeoutMs: 15_000,
    });
    if (!response.success || !response.buffer) {
      throw new Error(`Failed to fetch image: ${response.details ?? response.error ?? "unknown error"}`);
    }

    return response.buffer.toString("base64");
  }
}
