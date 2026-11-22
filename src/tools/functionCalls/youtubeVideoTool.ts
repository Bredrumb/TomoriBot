import { log, ColorCode } from "../../utils/misc/logger";
import type { EnhancedVideoContent } from "@/types/tool/enhancedContextTypes";
import { sendToolProgressNotice } from "@/utils/discord/toolProgressNotice";
import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "../../types/tool/interfaces";
import { ContextItemTag, type StructuredContextItem } from "../../types/misc/context";
import {
  resolveEffectiveOpenRouterModelCodename,
  resolveEffectiveOpenRouterSeesYouTube,
} from "@/utils/provider/openrouterModelCapabilities";

export class YouTubeVideoTool extends BaseTool {
  name = "process_youtube_video";
  description =
    "Analyze a YouTube video with Google vision. Use sparingly when video details are needed. Call only when a user-provided YouTube URL is visible in recent messages.";
  category = "utility" as const;
  requiredModelCapabilities = {
    sees_youtube: true,
  };

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      youtube_url: {
        type: "string",
        description:
          "Complete youtube.com/watch, youtu.be, youtube.com/embed, or youtube.com/shorts URL provided by the user.",
      },
      reason: {
        type: "string",
        description: "Why the video needs analysis.",
      },
    },
    required: ["youtube_url"],
  };

  private static readonly YOUTUBE_URL_PATTERNS = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/i,
    /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
  ];

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  isAvailableForContext(provider: string, context?: ToolContext): boolean {
    if (!this.isAvailableFor(provider)) {
      return false;
    }

    if (!context?.tomoriState) {
      log.warn("YouTubeVideoTool: No tomoriState in context, defaulting to unavailable");
      return false;
    }

    // OpenRouter Gemini models can use YouTube URLs even when the local DB flag is stale.
    const hasYouTube = resolveEffectiveOpenRouterSeesYouTube(context.tomoriState);

    if (!hasYouTube) {
      const effectiveModelCodename = resolveEffectiveOpenRouterModelCodename(context.tomoriState);
      log.info(
        `YouTubeVideoTool: Model ${effectiveModelCodename} does not support YouTube processing (effective sees_youtube=false). Tool disabled.`,
      );
      return false;
    }

    if (context?.streamContext?.disableYouTubeProcessing) {
      log.info("YouTubeVideoTool: Temporarily disabled during enhanced context restart");
      return false;
    }

    return true;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (context.streamContext?.disableYouTubeProcessing) {
      log.info(
        "YouTubeVideoTool: Execution blocked - YouTube processing temporarily disabled during enhanced context restart",
      );
      return {
        success: false,
        error: "YouTube processing is temporarily disabled",
        message: "YouTube video processing is temporarily disabled while analyzing another video.",
        data: {
          status: "temporarily_disabled",
          reason: "Enhanced context restart in progress",
        },
      };
    }

    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
        message:
          "The youtube_url argument was missing or not in the expected format. Please provide a valid YouTube URL.",
      };
    }

    const youtubeUrl = args.youtube_url as string;
    const reason = (args.reason as string) || "User-requested video analysis";

    log.info(`Processing YouTube video: ${youtubeUrl} - Reason: ${reason}`);

    await sendToolProgressNotice(
      context,
      "youtube_processing",
      {
        titleKey: "tools.video.youtube_processing_title",
        descriptionKey: "tools.video.youtube_processing_description",
        descriptionVars: { video_url: youtubeUrl },
        footerKey: "tools.video.youtube_processing_footer",
        color: ColorCode.INFO,
      },
      "YouTubeVideoTool",
    );

    try {
      const videoId = this.extractVideoId(youtubeUrl);
      if (!videoId) {
        return {
          success: false,
          error: "Invalid YouTube URL format",
          message:
            "The provided URL is not a valid YouTube URL. Please provide a valid YouTube link (youtube.com/watch, youtu.be, youtube.com/embed, or youtube.com/shorts).",
          data: {
            status: "invalid_url",
            provided_url: youtubeUrl,
            supported_formats: [
              "youtube.com/watch?v=...",
              "youtu.be/...",
              "youtube.com/embed/...",
              "youtube.com/shorts/...",
            ],
          },
        };
      }

      log.success(`YouTube video validated for enhanced context restart: ${youtubeUrl} (ID: ${videoId})`);

      // Special marker 'enhancedContext: true' indicates this should be processed by googleStreamAdapter
      const videoContextItem: StructuredContextItem = {
        role: "user",
        metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        parts: [
          {
            type: "text",
            text: "[System: This message contains video content from a previous YouTube processing request you made]",
          },
          {
            type: "video",
            uri: youtubeUrl,
            mimeType: "video/youtube",
            isYouTubeLink: true,
            enhancedContext: true,
          } as EnhancedVideoContent,
        ],
      };

      return {
        success: true,
        message: "YouTube video processing initiated - restarting with enhanced context",
        data: {
          type: "context_restart_with_youtube",
          video_id: videoId,
          video_url: youtubeUrl,
          reason: reason,
          enhanced_context_item: videoContextItem,
        },
      };
    } catch (error) {
      log.error(`YouTube video processing failed for URL: ${youtubeUrl}`, error as Error);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred during YouTube video processing",
        message:
          "Failed to process the YouTube video. This could be due to an invalid URL, network issues, or the video being unavailable. Please try with a different video URL.",
        data: {
          status: "video_processing_failed",
          provided_url: youtubeUrl,
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  private extractVideoId(url: string): string | null {
    for (const pattern of YouTubeVideoTool.YOUTUBE_URL_PATTERNS) {
      const match = url.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
    return null;
  }

  static isValidYouTubeUrl(url: string): boolean {
    return YouTubeVideoTool.YOUTUBE_URL_PATTERNS.some((pattern) => pattern.test(url));
  }

  static extractAllVideoIds(text: string): string[] {
    const videoIds: string[] = [];
    for (const pattern of YouTubeVideoTool.YOUTUBE_URL_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`));
      for (const match of matches) {
        if (match[1]) {
          videoIds.push(match[1]);
        }
      }
    }
    return [...new Set(videoIds)];
  }
}
