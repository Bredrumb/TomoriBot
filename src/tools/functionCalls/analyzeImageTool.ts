import { createProviderToolFailure } from "@/utils/provider/providerToolFailure";

import { escapeMarkdown } from "discord.js";
import { BaseTool } from "@/types/tool/interfaces";
import type { ToolContext, ToolResult, ToolParameterSchema } from "@/types/tool/interfaces";
import { log, ColorCode } from "@/utils/misc/logger";
import { sendToolProgressNotice } from "@/utils/discord/toolProgressNotice";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import {
  analyzeImageWithVisionModel,
  resolveVisionApiModelName,
  type VisionImage,
} from "@/utils/provider/visionCaption";
import { downloadDiscoveredImage, resolveMessageImageUrls } from "@/utils/image/imageExtractor";
import { notifyProviderToolFailure } from "@/utils/provider/providerUsage";

export { resolveVisionApiModelName } from "@/utils/provider/visionCaption";

const DISCORD_ID_PATTERN = /^\d{17,19}$/;

const DEFAULT_VISION_PROMPT =
  "Describe what you see in this image in detail. Include any text, objects, people, colors, and notable elements.";

const MAX_TOTAL_IMAGE_BYTES = MEDIA_LIMITS.MAX_MEDIA_SIZE_MB * 1024 * 1024;

const parsedVisionAnalysisTimeoutMs = Number.parseInt(process.env.VISION_ANALYSIS_TIMEOUT_MS ?? "", 10);
const VISION_ANALYSIS_TIMEOUT_MS =
  Number.isFinite(parsedVisionAnalysisTimeoutMs) && parsedVisionAnalysisTimeoutMs > 0
    ? parsedVisionAnalysisTimeoutMs
    : 60_000;

export class AnalyzeImageTool extends BaseTool {
  name = "analyze_image";
  description =
    "Analyze images in a Discord message using AI vision. Use this only when the user explicitly asks about the image or when unseen visual details are necessary to answer correctly. Do not call it just because an image is present.";
  category = "utility" as const;
  requiresFollowUp = true;

  // Only checks sees_images here; vision_llm availability is checked at execution time in isAvailableForContext().
  requiredModelCapabilities = { sees_images: false as const };

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      media_id: {
        type: "string",
        description:
          "The media reference ID (e.g., media_1) from the system hint for the message containing the image(s) to analyze.",
      },
      prompt: {
        type: "string",
        description:
          "Optional question or instruction for the vision model (e.g., 'What text is in this image?' or 'Describe the mood of this photo'). Ask only for the specific visual detail needed. If omitted, a general description is returned.",
      },
    },
    required: ["media_id"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  isAvailableForContext(_provider: string, context: ToolContext): boolean {
    const hasVisionModel = !!context.tomoriState?.vision_llm;
    const chatModelSeesImages = context.tomoriState?.llm?.sees_images ?? false;

    return hasVisionModel && !chatModelSeesImages;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const rawMediaId = args.media_id as string;
    const messageId = MessageIdMap.isOpaqueKey(rawMediaId) ? context.messageIdMap?.resolve(rawMediaId) : rawMediaId;
    const prompt = (args.prompt as string) || DEFAULT_VISION_PROMPT;

    if (!rawMediaId || (!DISCORD_ID_PATTERN.test(rawMediaId) && !MessageIdMap.isOpaqueKey(rawMediaId))) {
      return {
        success: false,
        error: `Invalid media_id: "${rawMediaId}". Expected a media reference ID (for example media_1) or Discord message ID.`,
      };
    }

    if (!messageId || !DISCORD_ID_PATTERN.test(messageId)) {
      return {
        success: false,
        error: `Unknown media_id: "${rawMediaId}".`,
      };
    }

    const timeoutSignal = AbortSignal.timeout(VISION_ANALYSIS_TIMEOUT_MS);
    const analysisSignal = context.abortSignal ? AbortSignal.any([context.abortSignal, timeoutSignal]) : timeoutSignal;

    try {
      await sendToolProgressNotice(
        context,
        "image_analysis",
        {
          titleKey: "tools.vision.analyzing_title",
          descriptionKey: "tools.vision.analyzing_description",
          descriptionVars: {
            // The resolved call resolves its own model, but it cannot report which one before
            // the first request, so this names the cached row the user configured.
            model: escapeMarkdown(
              resolveVisionApiModelName(
                context.tomoriState.vision_llm?.llm_provider ?? "",
                context.tomoriState.vision_llm?.llm_codename ?? "",
              ),
            ),
          },
          footerKey: "tools.vision.analyzing_footer",
          color: ColorCode.INFO,
        },
        "AnalyzeImageTool",
      );

      const images = await this.extractImagesFromMessage(messageId, context, analysisSignal);

      // The tool accepts one image per call, so a multi-image message is described one at a
      // time and joined: the caller asked for a reading of the message, not of its first file.
      const readings: string[] = [];
      for (const image of images) {
        const result = await analyzeImageWithVisionModel({
          serverId: context.tomoriState.server_id,
          locale: context.locale,
          image,
          prompt,
          cachedVisionLlm: context.tomoriState.vision_llm,
          userId: context.internalUserId ?? null,
          abortSignal: analysisSignal,
          // This tool owns the deadline it advertises, so the shared default must not become a
          // second, shorter one that silently overrides VISION_ANALYSIS_TIMEOUT_MS.
          timeoutMs: VISION_ANALYSIS_TIMEOUT_MS,
        });

        if (result.requestDenied) {
          return notifyProviderToolFailure(context, result.requestDenied);
        }
        if (!result.ok) {
          return {
            success: false,
            error: result.toolFailure?.reason ?? `Image analysis failed: ${describeVisionFailure(result.failure)}`,
            failure: result.toolFailure,
          };
        }

        readings.push(result.text ?? "");
      }

      const analysisResult = readings.join("\n\n");
      log.info(`Vision analysis completed: ${images.length} image(s) analyzed`);

      return {
        success: true,
        data: analysisResult,
        message: analysisResult,
      };
    } catch (error) {
      const timedOut = timeoutSignal.aborted && !context.abortSignal?.aborted;
      log.error(`Vision analysis failed for message ${messageId}:`, error as Error);
      return createProviderToolFailure(error, {
        locale: context.locale,
        provider: context.tomoriState.vision_llm?.llm_provider ?? "unknown",
        kind: timedOut ? "timeout" : undefined,
      });
    }
  }

  // Download loop stays local rather than using shared image downloaders because vision payloads enforce a cumulative
  // byte budget and skip re-optimization.
  private async extractImagesFromMessage(
    messageId: string,
    context: ToolContext,
    signal: AbortSignal,
  ): Promise<VisionImage[]> {
    const { imageUrls, sourceMessageId } = await resolveMessageImageUrls(messageId, context);

    log.info(`Found ${imageUrls.length} image(s) in message ${sourceMessageId} for vision analysis`);

    const inlineDataArray: VisionImage[] = [];
    let totalBytes = 0;

    for (const imageInfo of imageUrls) {
      try {
        const imageResponse = await downloadDiscoveredImage(imageInfo, {
          maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
          timeoutMs: 15_000,
          externalSignal: signal,
        });
        if (!imageResponse.success || !imageResponse.buffer) {
          log.warn(`Failed to fetch image from ${imageInfo.source}: ${imageResponse.details ?? imageResponse.error}`);
          continue;
        }

        const imageBuffer = imageResponse.buffer;

        if (totalBytes + imageBuffer.byteLength > MAX_TOTAL_IMAGE_BYTES) {
          log.warn(`Skipping image from ${imageInfo.source}: would exceed ${MAX_TOTAL_IMAGE_BYTES} byte limit`);
          continue;
        }

        totalBytes += imageBuffer.byteLength;
        const base64Data = imageBuffer.toString("base64");

        inlineDataArray.push({
          mimeType: imageInfo.mimeType,
          data: base64Data,
        });

        log.info(`Fetched image from ${imageInfo.source} (${imageBuffer.byteLength} bytes)`);
      } catch (imgErr) {
        log.warn(`Failed to process image from ${imageInfo.source}:`, imgErr as Error);
      }
    }

    if (inlineDataArray.length === 0) {
      throw new Error(`Failed to process any images from message ${sourceMessageId}`);
    }

    return inlineDataArray;
  }
}

function describeVisionFailure(failure: { reason: string; detail?: string } | undefined): string {
  if (!failure) return "unknown error";

  switch (failure.reason) {
    case "credentials_unavailable":
      return "no usable credentials for the configured vision model";
    case "no_vision_model":
      return "No vision model configured. Use /model vision to set one.";
    case "unsupported_provider":
      return failure.detail ?? "the configured vision provider has no supported transport";
    case "empty_response":
      return "the vision model returned an empty response";
    default:
      return failure.detail ?? "the vision request failed";
  }
}
