import { z } from "zod";
import type {
  ProviderNativeVideoGenerationRequest,
  ProviderNativeVideoGenerationResult,
  ProviderNativeVideoResolution,
} from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { pollForCompletion } from "@/utils/async/pollForCompletion";

const GOOGLE_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

const POLL_INTERVAL_MS = 10_000;

/** Maximum poll attempts before timeout (~5 minutes at 10s intervals) */
const MAX_POLL_ATTEMPTS = 30;

/** Aspect ratios Gemini Omni accepts; anything else is rejected with a 400. */
const GOOGLE_SUPPORTED_ASPECT_RATIOS = new Set(["16:9", "9:16"]);

const interactionSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  steps: z
    .array(
      z.object({
        content: z
          .array(z.object({ type: z.string(), data: z.string().optional(), mime_type: z.string().optional() }))
          .optional(),
      }),
    )
    .optional(),
  errors: z
    .array(z.object({ code: z.union([z.string(), z.number()]).optional(), message: z.string().optional() }))
    .optional(),
});

type GoogleInteraction = z.infer<typeof interactionSchema>;

function normalizeGoogleResolution(requestedResolution: ProviderNativeVideoResolution | undefined): "720p" | "1080p" {
  return requestedResolution === "1080p" ? "1080p" : "720p";
}

async function callInteractions(
  url: string,
  apiKey: string,
  abortSignal: AbortSignal | undefined,
  body?: unknown,
): Promise<GoogleInteraction> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    redirect: "error",
    signal: abortSignal,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return interactionSchema.parse(await response.json());
}

/** Generates a Gemini Omni video, ignoring `durationSeconds`, `fps`, and audio fields because Omni has no such controls. */
export async function generateGoogleNativeVideo(
  request: ProviderNativeVideoGenerationRequest,
): Promise<ProviderNativeVideoGenerationResult> {
  const resolution = normalizeGoogleResolution(request.resolution);
  const aspectRatio =
    request.aspectRatio && GOOGLE_SUPPORTED_ASPECT_RATIOS.has(request.aspectRatio) ? request.aspectRatio : undefined;
  const startImage = request.referenceImages?.[0];

  const body = {
    model: request.model,
    input: startImage
      ? [
          { type: "image", data: startImage.data, mime_type: startImage.mimeType },
          { type: "text", text: request.prompt },
        ]
      : request.prompt,
    response_format: { type: "video", resolution, ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}) },
    ...(startImage ? { generation_config: { video_config: { task: "image_to_video" } } } : {}),
    // A synchronous call can outlive the HTTP connection, so the job runs in the background and must be stored to be polled.
    background: true,
    store: true,
  };

  log.info(
    `Google video generation: submitting request (model: ${request.model}, aspectRatio: ${aspectRatio ?? "16:9"}, resolution: ${resolution}, hasReferenceImage: ${!!startImage})`,
  );

  let interaction = await callInteractions(GOOGLE_INTERACTIONS_URL, request.apiKey, request.abortSignal, body);
  const pollUrl = `${GOOGLE_INTERACTIONS_URL}/${encodeURIComponent(interaction.id)}`;

  const settled = await pollForCompletion<GoogleInteraction>({
    pollFn: async () => {
      if (interaction.status !== "in_progress") {
        return { done: true, result: interaction };
      }
      interaction = await callInteractions(pollUrl, request.apiKey, request.abortSignal);
      return interaction.status === "in_progress" ? { done: false } : { done: true, result: interaction };
    },
    intervalMs: POLL_INTERVAL_MS,
    maxAttempts: MAX_POLL_ATTEMPTS,
    logLabel: "GoogleVideoGeneration",
    abortSignal: request.abortSignal,
  });

  if (settled.status !== "completed") {
    throw new Error(`Google video interaction ended as ${settled.status}: ${JSON.stringify(settled.errors ?? [])}`);
  }

  const video = settled.steps?.flatMap((step) => step.content ?? []).find((part) => part.type === "video" && part.data);
  if (!video?.data) {
    log.warn(`Google video generation completed but returned no video (model: ${request.model})`);
    return { videoData: null, mimeType: null };
  }

  const videoData = Buffer.from(video.data, "base64");
  log.info(`Google video generation: got inline video (model: ${request.model}, sizeBytes: ${videoData.length})`);
  return { videoData, mimeType: video.mime_type ?? "video/mp4" };
}
