import { z } from "zod";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import type { FetchUserRemoteUrlOptions } from "@/utils/security/userRemoteFetch";
import { getProviderContentRejectionCode } from "@/utils/provider/providerErrorClassification";

export const IMAGE_GENERATION_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
export const imageUsageCostSchema = z
  .object({ cost: z.number().finite().nonnegative().nullish() })
  .nullish()
  .catch(undefined);

export function buildChatImageRequest(params: {
  model: string | null | undefined;
  prompt: string;
  aspectRatio: string;
  referenceImages?: Array<{ mimeType: string; data: string }>;
}) {
  return {
    model: params.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: params.prompt },
          ...(params.referenceImages ?? []).map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mimeType};base64,${image.data}` },
          })),
        ],
      },
    ],
    modalities: ["image", "text"],
    image_config: { aspect_ratio: params.aspectRatio },
    stream: false,
  };
}

export async function readChatImageResponse(
  response: Response,
  abortSignal?: AbortSignal,
  remotePolicy?: FetchUserRemoteUrlOptions,
): Promise<{ imageData: string | null; mimeType: string | null; costUsd?: number }> {
  const imageUrlSchema = z.object({ url: z.string() });
  const result = z
    .object({
      choices: z
        .array(
          z.object({
            finish_reason: z.string().nullish(),
            message: z
              .object({
                images: z
                  .array(
                    z.object({
                      image_url: imageUrlSchema.optional(),
                      imageUrl: imageUrlSchema.optional(),
                    }),
                  )
                  .optional(),
                content: z
                  .union([
                    z.string(),
                    z.array(
                      z.object({
                        type: z.string(),
                        image_url: imageUrlSchema.optional(),
                      }),
                    ),
                  ])
                  .nullish(),
              })
              .optional(),
          }),
        )
        .optional(),
      usage: imageUsageCostSchema,
    })
    .parse(
      JSON.parse(
        (await readBoundedResponse(response, IMAGE_GENERATION_RESPONSE_MAX_BYTES, abortSignal)).toString("utf8"),
      ),
    );
  const rejection = getProviderContentRejectionCode(result);
  if (rejection) throw Object.assign(new Error("Image request blocked by the provider"), { code: rejection });
  const message = result.choices?.[0]?.message;
  const image = message?.images?.[0];
  const imageUrl = image
    ? image.image_url?.url || image.imageUrl?.url
    : Array.isArray(message?.content)
      ? message.content.find((part) => part.type === "image_url")?.image_url?.url
      : undefined;
  const costUsd = result.usage?.cost ?? undefined;
  const empty = { imageData: null, mimeType: null, costUsd };
  if (!imageUrl) return empty;

  if (imageUrl.startsWith("data:")) {
    const data = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(imageUrl);
    if (!data?.[2] || data[2].length % 4 !== 0) throw new Error("Invalid generated image data URL");
    return { imageData: data[2], mimeType: data[1], costUsd };
  }
  if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
    throw new Error("Unsupported generated image URL");
  }
  const download = await safeDownload(imageUrl, {
    maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
    timeoutMs: 15_000,
    externalSignal: abortSignal,
    remotePolicy,
  });
  return download.success && download.buffer
    ? { imageData: download.buffer.toString("base64"), mimeType: download.contentType?.split(";")[0] || null, costUsd }
    : empty;
}
