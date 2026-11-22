import { providerContentRejectionSchema } from "@/utils/provider/providerErrorClassification";
import { createProviderToolFailure } from "@/utils/provider/providerToolFailure";
import { withProviderUsageContext } from "@/utils/provider/providerUsage";
import {
  findProviderRequestDeniedError,
  notifyProviderToolFailure,
  reportProviderUsage,
  type ProviderUsageContext,
} from "@/utils/provider/providerUsage";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { classifySendFailure } from "@/utils/discord/stream/sendFailureCache";

import { AttachmentBuilder } from "discord.js";
import { log, ColorCode } from "../../utils/misc/logger";
import { localizer } from "../../utils/text/localizer";
import { mediaDeliveryFailure, sendToolMediaPost } from "@/utils/discord/webhook/toolMediaDelivery";
import { DiscordDeliveryError } from "@/utils/discord/webhook/deliveryOutcome";
import { buildGeneratedVideoComponentsV2Payload } from "@/utils/discord/generatedVideoMessage";
import { buildGeneratedMediaSourceLine, type GeneratedMediaSource } from "@/utils/discord/generatedMediaMetadata";
import { recordMinimalNoticeRef } from "@/utils/discord/minimalNoticeBodies";
import {
  buildReferencedMessageUrl,
  buildVideoToolNoticeDescription,
  sendToolProgressNotice,
  isMinimalNotice,
} from "@/utils/discord/toolProgressNotice";
import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "../../types/tool/interfaces";
import { releaseVideoQuota, reserveVideoQuota, type VideoQuotaClaim } from "../../utils/quota/videoQuotaManager";
import { QuotaUnavailableError } from "@/utils/quota/quotaErrors";
import type { QuotaReservation } from "@/utils/db/repositories/QuotaRepository";
import { statRepository } from "@/utils/db/repositories";
import { resolveProviderFeatureImplementation } from "@/utils/provider/providerInfoRegistry";
import { generateCustomVideoViaEndpoint } from "@/providers/custom/customEndpointDispatcher";
import { formatCustomModelDisplay } from "@/utils/provider/customProviderUtils";
import type { ProviderNativeVideoResolution } from "@/types/provider/featureInterfaces";
import { getResolvedCapabilityModelId } from "@/utils/provider/credentialResolver";
import { resolveCredentialsWithMediaQuota } from "@/utils/quota/mediaQuotaGate";
import { llmModelRepo } from "@/utils/db/repositories/LlmModelRepository";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import {
  getDefaultOpenRouterVideoResolution,
  isOpenRouterVideoCapabilityError,
} from "@/providers/openrouter/openrouterVideoRequest";
import { isExpectedVideoFailure, ProviderVideoFilteredError } from "@/providers/utils/providerVideoErrors";
import { resolveMessageImageUrls } from "@/utils/image/imageExtractor";
import { beginTextModelHandoffBeforeComfyUi } from "@/utils/provider/textModelComfyUiHandoff";

// Discord rejects attachments over 25 MB in non-boosted servers, so video uploads are capped at that byte limit.
const DISCORD_FILE_SIZE_LIMIT = 25 * 1024 * 1024;
const DEFAULT_VIDEO_DURATION_SECONDS = 5;
const MAX_VIDEO_DURATION_SECONDS = 20;

export class GenerateVideoTool extends BaseTool {
  name = "generate_video";
  description = "Generate a short video with the active video model. Sends an MP4 to Discord, usually in 1-3 minutes.";
  category = "utility" as const;
  requiresFeatureFlag = "video_gen";

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      nsfw: {
        type: "boolean",
        description: "Send as a Discord spoiler.",
      },
      prompt: {
        type: "string",
        description:
          "Describe the scene, action, style, camera motion, dialogue, and sound. With a source image, describe how it should move or change.",
      },
      media_id: {
        type: "string",
        description:
          "Use a media ID such as media_1. The message's first image becomes the opening frame. Omit for text-to-video.",
      },
      aspect_ratio: {
        type: "string",
        description: "Defaults to 16:9. Providers that lack 1:1 fall back to 16:9.",
        enum: ["16:9", "9:16", "1:1"],
      },
      duration: {
        type: "number",
        description: "Seconds, default 5 and maximum 20. The provider may use its closest supported duration.",
      },
      resolution: {
        type: "string",
        description:
          "Defaults to 480p for Grok Imagine Video 1.5 Lite and 720p otherwise. The provider may use its closest supported resolution.",
        enum: ["480p", "720p", "1080p"],
      },
      generate_audio: {
        type: "boolean",
        description: "Enable for requested sound, music, speech, or ambience. Defaults to false.",
      },
      audio_prompt: {
        type: "string",
        description: "Optional audio directions when generate_audio is true. Defaults to the video prompt.",
      },
      loop: {
        type: "boolean",
        description:
          "For an explicitly requested image-to-video loop, use the source as the first and last frame. Defaults to false.",
      },
    },
    required: ["prompt"],
  };

  private normalizeDuration(rawDuration: unknown): number {
    if (typeof rawDuration !== "number" || !Number.isFinite(rawDuration)) {
      return DEFAULT_VIDEO_DURATION_SECONDS;
    }

    const normalized = Math.trunc(rawDuration);
    if (normalized < 1) {
      return 1;
    }

    return Math.min(normalized, MAX_VIDEO_DURATION_SECONDS);
  }

  private normalizeResolution(rawResolution: unknown, model: string): ProviderNativeVideoResolution {
    if (rawResolution === "480p" || rawResolution === "720p" || rawResolution === "1080p") {
      return rawResolution;
    }

    return getDefaultOpenRouterVideoResolution(model);
  }

  private resolveMediaId(rawMediaId: string | undefined, context: ToolContext): string | undefined {
    if (!rawMediaId) {
      return undefined;
    }

    return MessageIdMap.isOpaqueKey(rawMediaId)
      ? (context.messageIdMap ?? context.streamContext?.messageIdMap)?.resolve(rawMediaId)
      : rawMediaId;
  }

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  isAvailableForContext(_provider: string, context?: ToolContext): boolean {
    return (context?.tomoriState.config.video_model_id ?? null) !== null;
  }

  protected isEnabled(context: ToolContext): boolean {
    return context.tomoriState.config.videogen_enabled;
  }

  private async getVideoModelCodename(videoModelId: number): Promise<string> {
    const model = await llmModelRepo.loadVideoGenerationModelById(videoModelId);

    if (!model) {
      throw new Error(`Video model not found in database: ${videoModelId}`);
    }

    return model.codename;
  }

  private async sendGeneratedVideo(
    context: ToolContext,
    videoData: Buffer,
    filename: string,
    elapsedMs: number,
    spoiler: boolean,
    source: GeneratedMediaSource,
  ): Promise<import("discord.js").Message> {
    const config = context.tomoriState.config;
    const visibleSource = isMinimalNotice(config, "video_generation") ? undefined : source;
    const componentsPayload = buildGeneratedVideoComponentsV2Payload(
      filename,
      elapsedMs,
      context.locale,
      spoiler,
      visibleSource,
    );
    const files = () => [new AttachmentBuilder(videoData, { name: filename })];
    const message = await sendToolMediaPost(
      context,
      () => ({ files: files(), ...componentsPayload, withComponents: true }),
      () => ({
        files: files(),
        ...(visibleSource ? { content: buildGeneratedMediaSourceLine(context.locale, visibleSource) } : {}),
      }),
    );
    await recordMinimalNoticeRef(message.id, { kind: "generation", source });
    return message;
  }

  private async extractReferenceImageFromMessage(
    messageId: string,
    context: ToolContext,
  ): Promise<{ mimeType: string; data: string; url: string; fallbackUrl?: string } | null> {
    try {
      const { imageUrls, sourceMessageId } = await resolveMessageImageUrls(messageId, context);
      const image = imageUrls[0];
      if (!image) return null;
      if (sourceMessageId !== messageId) {
        log.info(`Using image from replied-to message ${sourceMessageId} for image-to-video reference ${messageId}`);
      }

      // Leave data empty and pass the URL so large images do not exceed provider request size limits.
      return {
        url: image.proxyUrl || image.url,
        ...(image.proxyUrl && image.proxyUrl !== image.url ? { fallbackUrl: image.url } : {}),
        mimeType: image.mimeType,
        data: "",
      };
    } catch (error) {
      log.error(`Failed to extract reference image from message ${messageId}`, error as Error);
      return null;
    }
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startedAtMs = Date.now();

    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
      };
    }

    if (!this.isEnabled(context)) {
      return {
        success: false,
        error: "Video generation is disabled for this server",
        message: localizer(context.locale, "tools.generate_video.disabled"),
      };
    }

    const userDiscId = context.userId || context.message?.author.id || "";
    if (!userDiscId) {
      return {
        success: false,
        error: "Unable to identify user for quota checking",
      };
    }

    const prompt = args.prompt as string;
    const rawMediaId = args.media_id as string | undefined;
    const messageId = this.resolveMediaId(rawMediaId, context);
    const aspectRatio = (args.aspect_ratio as string) || "16:9";
    const durationSeconds = this.normalizeDuration(args.duration);
    const generateAudio = args.generate_audio === true;
    const audioPrompt =
      typeof args.audio_prompt === "string" && args.audio_prompt.trim() ? args.audio_prompt.trim() : undefined;
    const loop = args.loop === true;
    const usesReference = !!messageId;

    if (rawMediaId && !messageId) {
      return {
        success: false,
        error: `Unknown media_id: "${rawMediaId}".`,
      };
    }

    if (
      typeof args.duration === "number" &&
      (!Number.isFinite(args.duration) || args.duration < 1 || args.duration > 20)
    ) {
      return {
        success: false,
        error: "Duration must be an integer between 1 and 20 seconds.",
      };
    }

    let quotaCheck: VideoQuotaClaim = { allowed: true, reservation: null };
    let usageContext: ProviderUsageContext | undefined;
    let failureProvider: string | undefined;
    let failureScope: "server" | "personal" | undefined;
    let quotaReservation: QuotaReservation | null = null;
    let quotaDelivered = false;

    try {
      const { credentials: creds, quotaCheck: serverQuotaCheck } = await resolveCredentialsWithMediaQuota(
        context.tomoriState.server_id,
        "video",
        context.internalUserId ?? null,
        reserveVideoQuota,
        userDiscId,
        quotaCheck,
      );
      quotaCheck = serverQuotaCheck;
      quotaReservation = serverQuotaCheck.reservation;

      if (!quotaCheck.allowed) {
        let errorMessage = "";
        let resetInfo = "";

        if (quotaCheck.resetTime) {
          const now = new Date();
          const hoursUntilReset = Math.ceil((quotaCheck.resetTime.getTime() - now.getTime()) / (1000 * 60 * 60));

          if (hoursUntilReset < 24) {
            resetInfo = localizer(context.locale, "tools.generate_video.quota_resets_in_hours", {
              hours: hoursUntilReset.toString(),
            });
          } else {
            const daysUntilReset = Math.ceil(hoursUntilReset / 24);
            resetInfo = localizer(context.locale, "tools.generate_video.quota_resets_in_days", {
              days: daysUntilReset.toString(),
            });
          }
        }

        if (quotaCheck.reason === "user_quota_exceeded") {
          errorMessage = localizer(context.locale, "tools.generate_video.user_quota_exceeded", {
            reset_info: resetInfo,
          });
        } else if (quotaCheck.reason === "serverwide_quota_exceeded") {
          errorMessage = localizer(context.locale, "tools.generate_video.serverwide_quota_exceeded", {
            reset_info: resetInfo,
          });
        } else {
          errorMessage = localizer(context.locale, "tools.generate_video.quota_exceeded_generic");
        }

        return {
          success: false,
          error: "Video generation quota exceeded",
          message: errorMessage,
        };
      }

      const videoModelId = getResolvedCapabilityModelId(creds, "video") ?? context.tomoriState.config.video_model_id;

      if (!videoModelId) {
        return {
          success: false,
          error:
            "No video model configured for this server. The active provider may not support video generation, or setup has not been completed.",
        };
      }

      const modelCodename = await this.getVideoModelCodename(videoModelId);
      const resolution = this.normalizeResolution(args.resolution, modelCodename);
      const displayModelName = creds.customEndpoint ? formatCustomModelDisplay(creds.customEndpoint) : modelCodename;
      const generationSource: GeneratedMediaSource = {
        provider: creds.provider,
        model: creds.customEndpoint?.model_name?.trim() || modelCodename,
      };
      log.info(`Using video model: ${modelCodename} for video generation`);

      const apiKey = creds.apiKey;
      usageContext = creds.usageContext;
      failureScope = creds.source;
      const executionProvider = creds.provider;
      failureProvider = executionProvider;

      const baseNoticeDescription = localizer(
        context.locale,
        usesReference ? "tools.video.generating_with_references_description" : "tools.video.generating_description",
      );
      const referencedMessageUrl = messageId ? buildReferencedMessageUrl(context, messageId) : null;
      const extraNoticeLines = usesReference
        ? [
            referencedMessageUrl
              ? localizer(context.locale, "tools.video.notice_reference_line", {
                  message_url: referencedMessageUrl,
                })
              : localizer(context.locale, "tools.video.notice_reference_count_line", {
                  count: "1",
                }),
          ]
        : [];
      await sendToolProgressNotice(
        context,
        "video_generation",
        {
          titleKey: "tools.video.generating_title",
          description: buildVideoToolNoticeDescription(
            context.locale,
            baseNoticeDescription,
            displayModelName,
            prompt,
            localizer(context.locale, "tools.video.generating_footer"),
            extraNoticeLines,
          ),
          color: ColorCode.INFO,
        },
        "GenerateVideoTool",
      );

      let referenceImages: Array<{ mimeType: string; data: string; url?: string; fallbackUrl?: string }> | undefined;

      if (messageId) {
        log.info(`Extracting reference image from message ${messageId} for image-to-video`);
        const refImage = await this.extractReferenceImageFromMessage(messageId, context);
        if (refImage) {
          referenceImages = [refImage];
          log.info(`Using reference image from message ${messageId} for image-to-video generation`);
        } else {
          log.warn(`No image found in message ${messageId}, proceeding with text-to-video`);
        }
      }

      log.info(
        `Generating video with ${executionProvider} via ${displayModelName}: "${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}" (aspect ratio: ${aspectRatio}, duration: ${durationSeconds}s, resolution: ${resolution})`,
      );

      let videoData: Buffer | null = null;
      let videoFilename = `generated_${Date.now()}.mp4`;
      const videoImplementation = resolveProviderFeatureImplementation(executionProvider, "videoGeneration");

      if (creds.customEndpoint) {
        const endpoint = creds.customEndpoint;
        const handoff =
          creds.customEndpoint.api_style === "comfyui"
            ? await beginTextModelHandoffBeforeComfyUi({
                tomoriState: context.tomoriState,
                comfyUi: { endpointUrl: creds.customEndpoint.endpoint_url, apiKey, usageContext },
              })
            : null;
        try {
          const result = await withProviderUsageContext(usageContext, () =>
            generateCustomVideoViaEndpoint({
              endpoint,
              apiKey,
              prompt,
              aspectRatio,
              durationSeconds,
              resolution,
              referenceImages,
              generateAudio,
              audioPrompt,
              loop,
              abortSignal: context.abortSignal,
            }),
          );
          videoData = result.videoData;
          videoFilename = result.filename ?? videoFilename;
        } finally {
          void handoff?.restore();
        }
      } else if (videoImplementation === "google") {
        const { generateGoogleNativeVideo } = await import("@/providers/google/googleVideoGeneration");
        const result = await withProviderUsageContext(usageContext, () =>
          generateGoogleNativeVideo({
            apiKey,
            model: modelCodename,
            prompt,
            aspectRatio,
            durationSeconds,
            resolution,
            referenceImages,
            generateAudio,
            audioPrompt,
            loop,
            abortSignal: context.abortSignal,
          }),
        );
        videoData = result.videoData;
        videoFilename = result.filename ?? videoFilename;
      } else if (videoImplementation === "openrouter") {
        const { generateOpenRouterNativeVideo } = await import("@/providers/openrouter/openrouterVideoGeneration");
        const result = await withProviderUsageContext(usageContext, async () =>
          generateOpenRouterNativeVideo({
            apiKey,
            model: modelCodename,
            prompt,
            aspectRatio,
            durationSeconds,
            resolution,
            referenceImages,
            generateAudio,
            audioPrompt,
            loop,
            abortSignal: context.abortSignal,
          }),
        );
        reportProviderUsage(usageContext, {
          modelCodename,
          costUsd: result.costUsd,
          providerRequestId: result.providerRequestId,
        });
        videoData = result.videoData;
        videoFilename = result.filename ?? videoFilename;
      } else if (videoImplementation === "zai") {
        const { generateZaiNativeVideo } = await import("@/providers/zai/zaiVideoGeneration");
        const result = await withProviderUsageContext(usageContext, () =>
          generateZaiNativeVideo({
            apiKey,
            model: modelCodename,
            prompt,
            aspectRatio,
            durationSeconds,
            resolution,
            referenceImages,
            generateAudio,
            audioPrompt,
            loop,
            abortSignal: context.abortSignal,
          }),
        );
        videoData = result.videoData;
        videoFilename = result.filename ?? videoFilename;
      } else {
        return {
          success: false,
          error: `Video generation is not implemented for provider ${executionProvider}`,
        };
      }

      if (!videoData) {
        return {
          success: false,
          error: "No video data received from API. The generation may have been blocked or failed.",
        };
      }

      // /kill stops awaiting this tool but cannot stop it, so a native provider that ignores the
      // signal still finishes here; posting now would deliver and charge for a reply the user killed.
      if (context.abortSignal?.aborted) {
        return { success: false, error: "Video generation was cancelled." };
      }

      if (videoData.length > DISCORD_FILE_SIZE_LIMIT) {
        const sizeMB = (videoData.length / (1024 * 1024)).toFixed(1);
        log.warn(`Generated video exceeds Discord file size limit: ${sizeMB}MB > 25MB`);
        return {
          success: false,
          error: localizer(context.locale, "tools.generate_video.file_too_large", { size_mb: sizeMB }),
          message: localizer(context.locale, "tools.generate_video.file_too_large", { size_mb: sizeMB }),
        };
      }

      log.info(
        `Sending generated video to Discord ${JSON.stringify({
          filename: videoFilename,
          bytes: videoData.length,
        })}`,
      );

      const elapsedMs = Date.now() - startedAtMs;
      const spoiler = args.nsfw === true;
      if (spoiler) {
        videoFilename = `SPOILER_${videoFilename}`;
      }
      const sentMessage = await this.sendGeneratedVideo(
        context,
        videoData,
        videoFilename,
        elapsedMs,
        spoiler,
        generationSource,
      );

      log.success("Successfully generated and sent video to Discord");

      quotaDelivered = true;
      // Record canonical generation telemetry for all providers; quotas enforce limits only.
      if (context.internalUserId) {
        statRepository.recordStat({
          serverId: context.tomoriState.server_id,
          userId: context.internalUserId,
          lineageId: context.tomoriState.persona_lineage_id ?? 0,
          metric: "video_generated",
          metricKey: modelCodename,
        });
      }

      let successMessage = `Successfully generated and sent video to Discord (message ID: ${sentMessage.id}). The video has been created based on your prompt${
        referenceImages ? " and the reference image" : ""
      } at ${resolution} for approximately ${durationSeconds} second(s).`;

      if (quotaCheck.userRemaining !== undefined) {
        const remainingText = localizer(context.locale, "tools.generate_video.quota_remaining", {
          remaining: quotaCheck.userRemaining.toString(),
        });
        successMessage += ` ${remainingText}`;
      }

      return {
        success: true,
        message: successMessage,
        data: generationSource,
        endTurn: context.streamContext?.endTurnAfterTools?.includes(this.name) ?? false,
      };
    } catch (error) {
      if (error instanceof QuotaUnavailableError) {
        return {
          success: false,
          error: "Quota check unavailable",
          message: localizer(context.locale, "tools.generate_video.quota_unavailable"),
        };
      }
      if (error instanceof DiscordDeliveryError) return mediaDeliveryFailure(context, error.outcome);
      if (context.abortSignal?.aborted) {
        return { success: false, error: "Video generation was cancelled." };
      }
      const denied = findProviderRequestDeniedError(error, usageContext);
      if (denied) return notifyProviderToolFailure(context, denied);
      const toolFailure = createProviderToolFailure(error, {
        locale: context.locale,
        provider: failureProvider ?? "unknown",
        credentialScope: failureScope,
        kind: error instanceof ProviderVideoFilteredError ? "content_blocked" : undefined,
      });
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!(error instanceof ProviderVideoFilteredError)) {
        await reportProviderFailure({
          summary: "Video generation failed",
          errorType: "VideoGenerationFailed",
          error,
          expected:
            providerContentRejectionSchema.safeParse(toolFailure.failure?.code).success ||
            isExpectedVideoFailure(errorMessage, toolFailure.failure?.code) ||
            classifySendFailure(error) !== null,
          serverId: context.tomoriState.server_id,
          userId: context.internalUserId ?? null,
          dimensions: { operation: "video-generation", provider: failureProvider ?? "unknown" },
        });
      }

      if (isOpenRouterVideoCapabilityError(error)) {
        const localizedMessage = localizer(
          context.locale,
          error.code === "last_frame_unsupported"
            ? "tools.generate_video.loop_unsupported"
            : "tools.generate_video.reference_unsupported",
          { model: error.model },
        );
        return {
          success: false,
          error: localizedMessage,
          message: localizedMessage,
          failure: { code: error.code, reason: localizedMessage, suggestedActions: [] },
        };
      }

      return toolFailure;
    } finally {
      if (quotaReservation && !quotaDelivered) {
        await releaseVideoQuota(context.tomoriState.server_id, userDiscId, quotaReservation);
      }
    }
  }
}
