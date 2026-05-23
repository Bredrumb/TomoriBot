/**
 * Image Generation Tool
 * Allows TomoriBot to generate images using the active provider's native image API
 * Supports text-to-image, and image-to-image only when the active provider supports it
 */

import { AttachmentBuilder } from "discord.js";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
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
import { MessageIdMap } from "@/utils/text/messageIdMap";
import type { ProviderNativeImageGenerationResult } from "@/types/provider/featureInterfaces";
import { optimizeImageBuffer } from "@/utils/image/imageProcessor";

const IMAGE_REFERENCE_MAX_COUNT = Number.parseInt(process.env.IMAGE_REFERENCE_MAX_COUNT ?? "3", 10);
const IMAGE_REFERENCE_MAX_TOTAL_BYTES = Number.parseInt(process.env.IMAGE_REFERENCE_MAX_TOTAL_BYTES ?? "6291456", 10);
const IMAGE_REFERENCE_TINY_MAX_BYTES = Number.parseInt(process.env.IMAGE_REFERENCE_TINY_MAX_BYTES ?? "950000", 10);

/**
 * Tool for generating images using the active provider's native image API
 */
export class GenerateImageTool extends BaseTool {
  name = "generate_image";
  description =
    "Generate an AI image using the active provider's native image model. Use this only when the user explicitly asks you to make, draw, generate, create, edit, or continue an image; do not call it for casual visual discussion. If the user asks you to make/draw/generate an image and this tool is available, call this tool instead of only describing the image. Provide a detailed text prompt describing what image you want to create. For text-to-image requests, creatively expand sparse user ideas into one coherent finished image with a clear subject, setting, pose, outfit, colors, mood, and lighting. If you provide a media_id or target_identity reference for normal image-to-image, treat the reference as loose inspiration and describe the desired new similar image with the requested changes clearly visible. Use inpainting instead for precise localized edits that should preserve most of the source image. For inpainting, keep the prompt tightly scoped to the masked region only and do not re-describe the whole subject/reference image. For example, use 'change hair to blonde with soft highlights' instead of a full character/scene description. Avoid negative wording in inpainting prompts: do not include clauses such as 'not black', 'no grey', or 'without stripes'; state only the desired replacement. For background-mode inpainting, describe the desired new surroundings explicitly, including the target background color, environment, location, atmosphere, lighting, or setting, plus desired replacement details rather than old surroundings to avoid. The mask_prompt must be a short phrase naming the existing region to mask, not the desired replacement. You can also specify an aspect ratio (default is 1:1). After generating, the image will be sent directly to the Discord channel.";
  category = "utility" as const;
  requiresFeatureFlag = "image_gen";

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "A detailed text description of the image you want to generate. For text-to-image, expand the user's idea into a complete, visually interesting final image: specify a single main subject or group, setting, action/pose, outfit, hair/eye colors when relevant, color palette, lighting, mood, camera framing, subject scale, and art style. For single-object prompts, specify a close or medium-close composition where the object is clearly visible and not tiny in an empty canvas. Avoid character sheets, multiple views, duplicate panels, or reference-sheet layouts unless the user explicitly asks for them. For normal image-to-image, describe the desired new similar image, using the reference only as loose inspiration; include the requested changes and enough scene/style detail for a fresh result. For inpainting, write only the local edit request for the masked area, such as 'change hair to blonde with natural shading' or 'make the irises emerald green with brighter highlights'. For outpainting, describe only what should plausibly continue into the newly revealed canvas beyond the requested edge; preserve the original image and do not reframe it. Do not ask for a new full-body image, duplicate subject, second character, giant face, giant torso, or unrelated character body parts in the added border. Do not include negative inpaint clauses like 'not black', 'no grey', or 'without stripes'; mention only the desired replacement color/material/pattern. For hair recolor inpainting, keep it color-only and do not add preservation clauses naming hairstyle parts like braids, bangs, or parting. Avoid full-scene or full-character descriptions in inpainting prompts. For background-mode inpainting, state the desired new surroundings strongly: color, environment, location, atmosphere, lighting, or setting; avoid naming old surroundings that should not remain. For recolors, name the desired new color/material strongly. For recolor inpainting, treat it as color-only unless the user explicitly asks for redesign: preserve garment/object type, shape, fit, seams, folds, and overall structure. Do not re-describe the whole subject/reference image for inpainting, and do not put the mask target there unless it is needed to explain the edit.",
      },
      media_id: {
        type: "string",
        description:
          "Optional: The media reference ID (e.g., media_1) from the system hint for the message containing images to use as reference for image-to-image generation or inpainting. The tool will extract all images from this message and use them to guide the generation along with your prompt. If not provided, generates a new image from scratch (text-to-image).",
      },
      inpaint: {
        type: "boolean",
        description:
          "Optional: Set to true when editing only a specific region of a referenced image. Requires media_id or target_identity. Use false or omit for normal image-to-image.",
      },
      mask_prompt: {
        type: "string",
        description:
          "Optional: Short phrase describing the existing region to edit when inpaint is true, such as 'cat', 'fur', 'chair', 'blue chest piece', or 'background'. Keep this to the object/area that should be masked. Do not describe the requested change here; for example, use 'cat' or 'fur', not 'a super fluffy orange tabby kitten'.",
      },
      clothing_segment_categories: {
        type: "array",
        description:
          "Optional for ComfyUI inpainting when mask_prompt is clothing-related: exact ComfyUI-RMBG ClothesSegment categories to mask. Use this when the user names a specific clothing part. For partially visible dresses, use ['Upper-clothes'] because the RMBG Dress class is temporarily disabled. Examples: ['Upper-clothes'] for a dress/shirt/top/hoodie/jacket, ['Pants'] for pants/shorts, ['Skirt'] for a skirt, ['Scarf'] for a scarf, or multiple categories for a full outfit. Omit for non-clothing masks.",
        items: {
          type: "string",
          enum: [
            "Hat",
            "Sunglasses",
            "Upper-clothes",
            "Skirt",
            "Belt",
            "Pants",
            "Bag",
            "Scarf",
            "Left-shoe",
            "Right-shoe",
          ],
        },
      },
      mask_threshold: {
        type: "number",
        description:
          "Optional inpaint tuning: GroundingDINO/SAM detection threshold from 0 to 10. Lower values include more candidate detections; higher values make detection stricter. Use around 0.45 for precise edits, lower values for small or stubborn targets.",
      },
      mask_grow: {
        type: "number",
        description:
          "Optional inpaint tuning: mask expansion in pixels from 0 to 128. Small values like 4-8 are precise; 12-32 gives recolors room; 48+ is loose and may change surrounding areas.",
      },
      mask_feather: {
        type: "number",
        description:
          "Optional inpaint tuning: mask blur/feather from 0 to 100. Lower values like 2-8 preserve edges; 12-28 blends broader edits but can bleed into nearby pixels.",
      },
      cfg: {
        type: "number",
        description:
          "Optional inpaint tuning: prompt guidance from 0 to 30. Use about 8-10 for most edits, 10-14 for stubborn color/material changes, lower if the result overpowers the reference.",
      },
      denoise: {
        type: "number",
        description:
          "Optional img2img/inpaint tuning: strength from 0 to 1. Lower values preserve the reference more; higher values allow stronger visible changes. Normal image-to-image should usually be loose inspiration around 0.7-0.85. Try 0.3 for tiny touch-ups, 0.85-0.95 for recolors or material changes, and 0.9-1.0 for stubborn broad changes.",
      },
      mask_mode: {
        type: "string",
        description:
          "Optional for inpainting: Use 'target' to edit the detected mask_prompt region itself. Use 'background' for background/setting edits. In background mode, set mask_prompt to the existing foreground object to protect, such as 'apple', 'person', 'car', or 'main foreground object'. Avoid using 'background' as the mask_prompt unless no foreground subject can be named.",
        enum: ["target", "background"],
      },
      inpaint_preset: {
        type: "string",
        description:
          "Optional inpaint edit category. Prefer this over hand-picking raw tuning values. Use 'tight_recolor' when the edit should stay confined to a smaller region (examples: eye color, hair color, small accessories, logos, badges, jewelry details, compact object accents). Use 'broad_recolor' when the edit should cover larger connected regions (examples: full shirt/hoodie/cardigan recolor, entire dress or skirt recolor, pants recolor, large object recolor, bigger foreground props, broad scene element recolors). Use 'background' for backdrop/setting/location edits and 'extend' for edits that grow beyond the current silhouette.",
        enum: ["small_detail", "tight_recolor", "broad_recolor", "background", "extend"],
      },
      inpaint_mode: {
        type: "string",
        description:
          "Optional: Inpaint behavior. Use 'normal' to edit the detected region itself, 'extend' when the edit must grow beyond the current silhouette into nearby space, or 'outpaint' when the image canvas itself should be expanded to reveal more beyond an edge.",
        enum: ["normal", "extend", "outpaint"],
      },
      outpaint: {
        type: "boolean",
        description:
          "Optional: Set true when the user asks to extend the image canvas itself upward, downward, left, right, or around the image to see more beyond what was cropped. Requires media_id or target_identity. Do not also set inpaint=true; outpaint uses the required inpaint-style provider workflow internally. This is different from normal inpainting or silhouette extension.",
      },
      outpaint_strategy: {
        type: "string",
        description:
          "Optional for outpainting: Use 'full_canvas' for NovelAI-style expanded-canvas inpainting when the ComfyUI workflow supports it. Use 'edge_extend' to preserve the original source scale and add pixels beyond one or more edges. Use 'zoom_out' only when the workflow supports placing the original image smaller inside a larger generated scene.",
        enum: ["full_canvas", "edge_extend", "zoom_out"],
      },
      extend_direction: {
        type: "string",
        description:
          "Optional for inpaint_mode='extend', inpaint_mode='outpaint', or outpaint=true: Direction to extend. For outpainting, this is the image edge to reveal more beyond. Use 'all' when the user asks to zoom out, pull back, make a wider or wide-angle shot, or expand in all directions. Use 'down' for legs, feet, lower body, full outfit, floor, or ground only when the user asks to reveal that lower area without asking to zoom out. Use 'up' for sky, ceiling, headroom, or top of the head; left/right for side context.",
        enum: ["down", "up", "left", "right", "down_left", "down_right", "up_left", "up_right", "all"],
      },
      extend_pixels: {
        type: "number",
        description:
          "Optional for inpaint_mode='extend', inpaint_mode='outpaint', or outpaint=true: Approximate number of pixels to extend. Use 64-128 for small silhouette extensions and 192-384 for canvas outpainting.",
      },
      outpaint_overlap: {
        type: "number",
        description:
          "Optional for outpainting: pixels of the original image edge that may be included in the editable transition mask before the original is composited back. Use 16-48 for smoother joins; default is provider-configured.",
      },
      outpaint_zoom_scale: {
        type: "number",
        description:
          "Optional for outpaint_strategy='zoom_out': scale for placing the original image inside the expanded canvas, from 0.5 to 0.95. Ignored by full_canvas and edge_extend strategies.",
      },
      target_identity: {
        type: "string",
        description:
          "Optional: User or persona identity whose profile picture/avatar should be used as a reference image. Accepts 'self', an exact persona nickname, or a natural user name from the current conversation or server. Deprecated raw IDs are still accepted at execution time for compatibility. Do not set this when media_id already points to the image to edit, unless the user explicitly asks to include the avatar/profile picture as an additional reference.",
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

  private shouldUseInpaint(args: Record<string, unknown>): boolean {
    if (typeof args.mask_mode === "string" || typeof args.mask_prompt === "string" || typeof args.inpaint_preset === "string") {
      return true;
    }
    if (typeof args.inpaint_mode === "string" && ["extend", "outpaint"].includes(args.inpaint_mode.toLowerCase())) {
      return true;
    }
    if (args.outpaint === true) {
      return true;
    }
    if (typeof args.outpaint === "string" && args.outpaint.toLowerCase() === "true") {
      return true;
    }
    if (args.inpaint === true) {
      return true;
    }
    if (typeof args.inpaint === "string") {
      return args.inpaint.toLowerCase() === "true";
    }

    return false;
  }

  private shouldUseOutpaint(args: Record<string, unknown>): boolean {
    if (args.outpaint === true) {
      return true;
    }
    if (typeof args.outpaint === "string" && args.outpaint.toLowerCase() === "true") {
      return true;
    }
    return typeof args.inpaint_mode === "string" && args.inpaint_mode.toLowerCase() === "outpaint";
  }

  private isExplicitInpaintTrue(args: Record<string, unknown>): boolean {
    if (args.inpaint === true) {
      return true;
    }
    return typeof args.inpaint === "string" && args.inpaint.toLowerCase() === "true";
  }

  private resolveOutpaintDirection(prompt: string, direction: string | null, strategy: string | null): string | null {
    if (strategy === "zoom_out") {
      return "all";
    }
    if (direction && direction !== "all") {
      return direction;
    }
    const normalizedPrompt = prompt.toLowerCase();
    const explicitlyZoomOut =
      /\b(?:zoom out|pull back|wider shot|wide shot|wide[-\s]?angle(?: shot)?|wide framing|wider view|wide view|more distant shot)\b/.test(
        normalizedPrompt,
      );
    const explicitlyAllDirections = /\b(?:all directions|all sides|every side|around the whole image)\b/.test(
      normalizedPrompt,
    );
    if (explicitlyZoomOut || explicitlyAllDirections) {
      return "all";
    }

    if (
      /\b(?:legs?|feet|foot|shoes?|boots?|knees?|calves|thighs?|lower body|lower half|full[-\s]?body|full outfit|whole outfit|entire outfit|entire silhouette|floor|ground|below|underneath)\b/.test(
        normalizedPrompt,
      )
    ) {
      return "down";
    }
    if (/\b(?:sky|clouds?|ceiling|headroom|top of (?:the )?head|above)\b/.test(normalizedPrompt)) {
      return "up";
    }
    return direction;
  }

  private resolveOutpaintStrategy(prompt: string, strategy: string | null): string | null {
    const normalizedStrategy = strategy?.trim().toLowerCase().replace(/[-\s]+/g, "_") ?? "";
    if (normalizedStrategy === "full_canvas" || normalizedStrategy === "edge_extend" || normalizedStrategy === "zoom_out") {
      return normalizedStrategy;
    }
    if (/\b(?:full[-\s]?canvas|novelai[-\s]?style|expanded[-\s]?canvas)\b/i.test(prompt)) {
      return "full_canvas";
    }
    if (
      /\b(?:zoom out|pull back|wider shot|wide shot|wide[-\s]?angle(?: shot)?|wide framing|wider view|wide view|more distant shot|full[-\s]?body|full outfit|whole outfit|entire outfit|entire silhouette)\b/i.test(
        prompt,
      )
    ) {
      return "full_canvas";
    }
    return null;
  }

  private formatOutpaintDirection(direction: string | null): string {
    const normalized = direction?.trim().toLowerCase() || "down";
    if (normalized === "all") {
      return "all directions";
    }
    return normalized.replaceAll("_", " ");
  }

  private formatNoticeValue(value: string, maxLength = 120): string {
    const cleaned = value.replaceAll("`", "'").replace(/\s+/g, " ").trim();
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3).trimEnd()}...` : cleaned;
  }

  private parseClampedNumber(value: unknown, min: number, max: number): number | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return Math.min(max, Math.max(min, parsed));
  }

  private resolveMediaId(rawMediaId: string | undefined, context: ToolContext): string | undefined {
    if (!rawMediaId) {
      return undefined;
    }

    return MessageIdMap.isOpaqueKey(rawMediaId)
      ? (context.messageIdMap ?? context.streamContext?.messageIdMap)?.resolve(rawMediaId)
      : rawMediaId;
  }

  private shouldSuppressThoughtLogDiagnostic(context: ToolContext): boolean {
    if (!context.tomoriState.config.thought_log_channel_disc_id) {
      return true;
    }
    if (
      "isDMBased" in context.channel &&
      typeof context.channel.isDMBased === "function" &&
      context.channel.isDMBased()
    ) {
      return true;
    }

    const privateChannelIds = context.tomoriState.config.private_channel_ids ?? [];
    const parentId = context.channel.isThread() ? context.channel.parentId : null;
    return (
      privateChannelIds.includes(context.channel.id) || (parentId !== null && privateChannelIds.includes(parentId))
    );
  }

  private async sendDiagnosticImagesToThoughtLog(
    context: ToolContext,
    diagnostics: ProviderNativeImageGenerationResult["diagnosticImages"],
    prompt: string,
  ): Promise<void> {
    if (!diagnostics?.length || this.shouldSuppressThoughtLogDiagnostic(context)) {
      return;
    }

    const thoughtLogChannelId = context.tomoriState.config.thought_log_channel_disc_id;
    if (!thoughtLogChannelId) {
      return;
    }

    const thoughtLogChannel = await context.client.channels.fetch(thoughtLogChannelId).catch(() => null);
    if (
      !thoughtLogChannel ||
      !("send" in thoughtLogChannel) ||
      typeof thoughtLogChannel.send !== "function" ||
      ("isDMBased" in thoughtLogChannel &&
        typeof thoughtLogChannel.isDMBased === "function" &&
        thoughtLogChannel.isDMBased())
    ) {
      log.warn(`GenerateImageTool: Thought log channel ${thoughtLogChannelId} is missing. Skipping diagnostic image.`);
      return;
    }

    const promptPreview = prompt.length > 700 ? `${prompt.slice(0, 697).trimEnd()}...` : prompt;
    const sourceLine = context.message?.url ?? context.channel.toString();
    for (const [index, diagnostic] of diagnostics.entries()) {
      const extension = diagnostic.mimeType === "image/jpeg" ? "jpg" : "png";
      const attachment = new AttachmentBuilder(Buffer.from(diagnostic.imageData, "base64"), {
        name: diagnostic.filename ?? `inpaint_mask_${index + 1}.${extension}`,
      });
      await thoughtLogChannel.send({
        content: [
          `**Image generation diagnostic:** ${diagnostic.label}`,
          ...(diagnostic.details ? [`Settings: ${diagnostic.details}`] : []),
          `Source: ${sourceLine}`,
          `Prompt: ${promptPreview}`,
        ].join("\n"),
        files: [attachment],
      });
    }
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
      const imageAttachments = message.attachments.filter((attachment) => this.isLikelyImageAttachment(attachment));

      for (const attachment of imageAttachments.values()) {
        imageUrls.push({
          url: attachment.url,
          mimeType: attachment.contentType || this.inferImageMimeType(attachment.name || attachment.url || ""),
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
          const optimized = await optimizeImageBuffer(imageResponse.buffer, imageInfo.mimeType);

          inlineDataArray.push({
            mimeType: optimized.mimeType,
            data: optimized.data,
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
    const rawMediaId = args.media_id as string | undefined;
    const messageId = this.resolveMediaId(rawMediaId, context);
    const targetIdentity = (args.target_identity as string | undefined) ?? (args.user_id as string | undefined);
    const requestedAspectRatio = typeof args.aspect_ratio === "string" ? args.aspect_ratio : null;
    let aspectRatio = requestedAspectRatio || "1:1";
    const usesReferences = !!(messageId || targetIdentity);
    const inpaint = this.shouldUseInpaint(args);
    const outpaint = this.shouldUseOutpaint(args);
    const explicitInpaint = this.isExplicitInpaintTrue(args);
    const maskPrompt = (args.mask_prompt as string | undefined)?.trim() || (outpaint ? "main foreground object" : null);
    const maskThreshold = this.parseClampedNumber(args.mask_threshold, 0, 1);
    const maskGrow = this.parseClampedNumber(args.mask_grow, 0, 128);
    const maskFeather = this.parseClampedNumber(args.mask_feather, 0, 100);
    const clothingSegmentCategories = Array.isArray(args.clothing_segment_categories)
      ? args.clothing_segment_categories.filter((category): category is string => typeof category === "string")
      : null;
    const cfg = this.parseClampedNumber(args.cfg, 0, 30);
    const denoise = this.parseClampedNumber(args.denoise, 0, 1);
    const maskMode = typeof args.mask_mode === "string" ? args.mask_mode : null;
    const inpaintPreset = typeof args.inpaint_preset === "string" ? args.inpaint_preset : null;
    const inpaintMode = outpaint ? "outpaint" : typeof args.inpaint_mode === "string" ? args.inpaint_mode : null;
    const rawOutpaintStrategy = typeof args.outpaint_strategy === "string" ? args.outpaint_strategy : null;
    const outpaintStrategy = outpaint ? this.resolveOutpaintStrategy(prompt, rawOutpaintStrategy) : rawOutpaintStrategy;
    const rawExtendDirection = typeof args.extend_direction === "string" ? args.extend_direction : null;
    const extendDirection = outpaint
      ? this.resolveOutpaintDirection(prompt, rawExtendDirection, outpaintStrategy)
      : rawExtendDirection;
    const extendPixels = this.parseClampedNumber(args.extend_pixels, 0, 512);
    const outpaintOverlap = this.parseClampedNumber(args.outpaint_overlap, 0, 256);
    const outpaintZoomScale = this.parseClampedNumber(args.outpaint_zoom_scale, 0.5, 0.95);

    if (rawMediaId && !messageId) {
      return {
        success: false,
        error: `Unknown media_id: "${rawMediaId}".`,
      };
    }
    if (inpaint && !usesReferences) {
      return {
        success: false,
        error: "Inpaint requires media_id or target_identity.",
      };
    }
    if (outpaint && explicitInpaint) {
      return {
        success: false,
        error:
          "Outpaint requests must not also set inpaint=true. Use outpaint=true or inpaint_mode='outpaint' by itself; the ComfyUI provider will use the required inpaint-style workflow internally.",
      };
    }
    if (inpaint && !outpaint && !maskPrompt) {
      return {
        success: false,
        error: "Inpaint requires mask_prompt describing the existing region to edit.",
      };
    }

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
        const imageModeKey = outpaint
          ? "genai.image.mode_outpaint"
          : inpaint
            ? "genai.image.mode_inpaint"
            : usesReferences
              ? "genai.image.mode_img2img"
              : "genai.image.mode_txt2img";
        extraNoticeLines.push(
          localizer(context.locale, "genai.image.notice_mode_line", {
            mode: localizer(context.locale, imageModeKey),
          }),
        );
        if (outpaint) {
          extraNoticeLines.push(
            localizer(context.locale, "genai.image.notice_outpaint_direction_line", {
              direction: this.formatOutpaintDirection(extendDirection),
            }),
          );
        }
        if (inpaint && !outpaint && maskPrompt) {
          extraNoticeLines.push(`Mask: \`${this.formatNoticeValue(maskPrompt)}\``);
        }
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

      const allowAvatarReference = !!targetIdentity && !(inpaint && !!messageId);

      if (targetIdentity && allowAvatarReference) {
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
          if (referenceImages.length > 0) {
            log.warn(
              `Continuing image generation without target_identity "${targetIdentity}" because message reference image(s) are available`,
            );
          } else {
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
      }

      const normalizedReferenceImages = await this.normalizeReferenceImages(referenceImages, {
        keepAtLeastOne: inpaint,
      });
      if (normalizedReferenceImages.length !== referenceImages.length) {
        log.info(
          `Reference images normalized from ${referenceImages.length} to ${normalizedReferenceImages.length} to avoid oversized requests`,
        );
      }
      referenceImages.length = 0;
      referenceImages.push(...normalizedReferenceImages);
      if (inpaint && !requestedAspectRatio && referenceImages.length > 0) {
        const referenceAspectRatio = await this.inferReferenceImageAspectRatio(referenceImages[0]);
        if (referenceAspectRatio) {
          aspectRatio = referenceAspectRatio;
          log.info(`Inpaint aspect ratio inferred from reference image: ${aspectRatio}`);
        }
      }

      // Call appropriate provider API
      log.info(
        `Generating image with ${executionProvider} via ${displayModelName}: "${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}" (aspect ratio: ${aspectRatio})`,
      );
      log.info(
        `GenerateImageTool inpaint settings ${JSON.stringify({
          inpaint,
          maskPrompt,
          maskThreshold: inpaint ? maskThreshold : null,
          maskGrow: inpaint ? maskGrow : null,
          maskFeather: inpaint ? maskFeather : null,
          clothingSegmentCategories: inpaint ? clothingSegmentCategories : null,
          outpaint: inpaint ? outpaint : null,
          outpaintStrategy: inpaint ? outpaintStrategy : null,
          outpaintOverlap: inpaint ? outpaintOverlap : null,
          outpaintZoomScale: inpaint ? outpaintZoomScale : null,
          extendDirection: inpaint ? extendDirection : null,
          extendPixels: inpaint ? extendPixels : null,
          cfg: inpaint ? cfg : null,
          denoise: usesReferences ? denoise : null,
        })}`,
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
        try {
          const result = await generateCustomImageViaEndpoint({
            endpoint: creds.customEndpoint,
            apiKey,
            prompt,
            aspectRatio,
            referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
            inpaint,
            maskPrompt,
            inpaintMaskMode: maskMode,
            inpaintPreset,
            inpaintMode,
            outpaint,
            outpaintStrategy,
            outpaintOverlap,
            outpaintZoomScale,
            inpaintExtendDirection: extendDirection,
            inpaintExtendPixels: extendPixels,
            clothingSegmentCategories,
          });
          generatedImageData = result.imageData;
          await this.sendDiagnosticImagesToThoughtLog(context, result.diagnosticImages, prompt);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const tooLarge =
            msg.toLowerCase().includes("request entity too large") ||
            msg.includes("413") ||
            msg.toLowerCase().includes("payload too large");
          if (tooLarge && referenceImages.length > 0) {
            log.warn("Custom endpoint request was too large; retrying with tiny single-reference payload");
            const tinyRef = await this.buildTinyReferenceImage(referenceImages[0]);
            const retryResult = await generateCustomImageViaEndpoint({
              endpoint: creds.customEndpoint,
              apiKey,
              prompt,
              aspectRatio,
              referenceImages: [tinyRef],
              inpaint,
              maskPrompt,
              inpaintMaskMode: maskMode,
              inpaintPreset,
              inpaintMode,
              outpaint,
              outpaintStrategy,
              outpaintOverlap,
              outpaintZoomScale,
              inpaintExtendDirection: extendDirection,
              inpaintExtendPixels: extendPixels,
              clothingSegmentCategories,
            });
            generatedImageData = retryResult.imageData;
            await this.sendDiagnosticImagesToThoughtLog(context, retryResult.diagnosticImages, prompt);
          } else {
            throw err;
          }
        }
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
    const dataUrlMatches = imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
    if (dataUrlMatches?.[1]) {
      return dataUrlMatches[1];
    }

    if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
      throw new Error(`Profile picture URL is not fetchable: ${imageUrl.split(":")[0] || "unknown"} protocol`);
    }

    const response = await safeDownload(imageUrl, {
      maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
      timeoutMs: 15_000,
    });
    if (!response.success || !response.buffer) {
      throw new Error(`Failed to fetch image: ${response.details ?? response.error ?? "unknown error"}`);
    }

    return response.buffer.toString("base64");
  }
  private inferImageMimeType(urlOrName: string, fallback = "image/jpeg"): string {
    const lower = urlOrName.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".bmp")) return "image/bmp";
    if (lower.endsWith(".avif")) return "image/avif";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    return fallback;
  }

  private isLikelyImageAttachment(attachment: { contentType?: string | null; name?: string | null; url?: string }): boolean {
    if (attachment.contentType?.startsWith("image/")) {
      return true;
    }
    const inferred = this.inferImageMimeType(attachment.name || attachment.url || "", "");
    return inferred.startsWith("image/");
  }

  private async normalizeReferenceImages(
    referenceImages: Array<{ mimeType: string; data: string }>,
    options?: { keepAtLeastOne?: boolean },
  ): Promise<Array<{ mimeType: string; data: string }>> {
    const normalized: Array<{ mimeType: string; data: string }> = [];
    let totalBytes = 0;
    const capped = referenceImages.slice(0, IMAGE_REFERENCE_MAX_COUNT);
    if (referenceImages.length > IMAGE_REFERENCE_MAX_COUNT) {
      log.warn(
        `Reference image count ${referenceImages.length} exceeded cap ${IMAGE_REFERENCE_MAX_COUNT}; keeping first ${IMAGE_REFERENCE_MAX_COUNT}`,
      );
    }

    for (const ref of capped) {
      try {
        const raw = Buffer.from(ref.data, "base64");
        const optimized = await optimizeImageBuffer(raw, ref.mimeType || "image/jpeg");
        const optimizedBytes = Buffer.byteLength(optimized.data, "base64");
        if (totalBytes + optimizedBytes > IMAGE_REFERENCE_MAX_TOTAL_BYTES) {
          if (normalized.length === 0 && options?.keepAtLeastOne) {
            log.warn(
              `Keeping first oversize reference image (${optimizedBytes} bytes) for inpaint fallback to avoid empty reference set`,
            );
            normalized.push({
              mimeType: optimized.mimeType,
              data: optimized.data,
            });
            totalBytes += optimizedBytes;
            continue;
          }
          log.warn(
            `Skipping reference image (${optimizedBytes} bytes) to stay under total cap ${IMAGE_REFERENCE_MAX_TOTAL_BYTES} bytes`,
          );
          continue;
        }
        totalBytes += optimizedBytes;
        normalized.push({
          mimeType: optimized.mimeType,
          data: optimized.data,
        });
      } catch (err) {
        log.warn("Failed to normalize one reference image, skipping it", err as Error);
      }
    }

    if (normalized.length === 0 && referenceImages.length > 0) {
      const first = referenceImages[0];
      const fallbackBytes = Buffer.byteLength(first.data, "base64");
      if (fallbackBytes <= IMAGE_REFERENCE_MAX_TOTAL_BYTES || options?.keepAtLeastOne) {
        if (fallbackBytes > IMAGE_REFERENCE_MAX_TOTAL_BYTES) {
          log.warn(`Keeping oversize fallback reference image (${fallbackBytes} bytes) because keepAtLeastOne=true`);
        }
        normalized.push(first);
      }
    }

    return normalized;
  }

  private async buildTinyReferenceImage(referenceImage: {
    mimeType: string;
    data: string;
  }): Promise<{ mimeType: string; data: string }> {
    const input = Buffer.from(referenceImage.data, "base64");
    let quality = 72;
    for (const maxDim of [1024, 896, 768, 640, 512]) {
      const encoded = await sharp(input)
        .resize({
          width: maxDim,
          height: maxDim,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (encoded.byteLength <= IMAGE_REFERENCE_TINY_MAX_BYTES) {
        return {
          mimeType: "image/jpeg",
          data: encoded.toString("base64"),
        };
      }
      quality = Math.max(45, quality - 8);
    }

    const finalBuffer = await sharp(input)
      .resize({
        width: 512,
        height: 512,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 42, mozjpeg: true })
      .toBuffer();
    return {
      mimeType: "image/jpeg",
      data: finalBuffer.toString("base64"),
    };
  }

  private async inferReferenceImageAspectRatio(referenceImage: { mimeType: string; data: string }): Promise<string | null> {
    try {
      const metadata = await sharp(Buffer.from(referenceImage.data, "base64")).metadata();
      if (!metadata.width || !metadata.height) {
        return null;
      }
      const divisor = this.greatestCommonDivisor(metadata.width, metadata.height);
      return `${Math.round(metadata.width / divisor)}:${Math.round(metadata.height / divisor)}`;
    } catch (err) {
      log.warn("Failed to infer reference image aspect ratio", err as Error);
      return null;
    }
  }

  private greatestCommonDivisor(a: number, b: number): number {
    let x = Math.abs(Math.round(a));
    let y = Math.abs(Math.round(b));
    while (y !== 0) {
      const next = x % y;
      x = y;
      y = next;
    }
    return x || 1;
  }
}
