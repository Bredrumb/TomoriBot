import type { Part } from "@google/genai";
import type { FunctionResponseImageMetadata } from "@/types/provider/interfaces";
import type { StreamContext } from "@/types/stream/interfaces";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";
import { log } from "@/utils/misc/logger";
import { unseenToolImageNotice } from "@/providers/utils/strictChatCompat";

export interface ToolResponseMediaInput {
  adapterName: string;
  imageMetadata?: FunctionResponseImageMetadata;
  seesImages: boolean;
  messageIdMap?: StreamContext["messageIdMap"];
}

// Vertex rejects inline data or text inside function-response turns, so both Gemini adapters emit these parts in a
// separate user turn.
export async function buildGeminiToolMediaParts({
  adapterName,
  imageMetadata,
  seesImages,
  messageIdMap,
}: ToolResponseMediaInput): Promise<Part[]> {
  const parts: Part[] = [];
  const imageUrls = imageMetadata?.imageUrls ?? [];

  if (imageUrls.length > 0) {
    if (seesImages) {
      log.info(`Adding ${imageUrls.length} image(s) to function response for LLM visibility`);

      for (const imageInfo of imageUrls) {
        try {
          const optimized = await fetchAndOptimizeImage(imageInfo.url, imageInfo.mimeType || "image/jpeg");

          parts.push({
            inlineData: {
              mimeType: optimized.mimeType,
              data: optimized.data,
            },
          });

          log.success(`Successfully added image to function response: ${imageInfo.url}`);
        } catch (imgErr) {
          log.warn(`Error processing image for function response: ${imageInfo.url}`, {
            error: imgErr instanceof Error ? imgErr.message : String(imgErr),
          });
        }
      }
    } else {
      // The tool response already told the model it delivered images, so dropping them
      // silently invites it to describe pictures it never received.
      parts.push({ text: unseenToolImageNotice(imageUrls.length) });
      log.info(`${adapterName}: Skipping tool images (model does not support images)`);
    }
  }

  const messageIds = imageMetadata?.messageIds ?? [];
  if (messageIds.length > 0) {
    parts.push({
      text: `[System: Images were sent to Discord in message ID(s): ${messageIds.map((id) => messageIdMap?.register(id, "media") ?? id).join(", ")}]`,
    });
  }

  return parts;
}
