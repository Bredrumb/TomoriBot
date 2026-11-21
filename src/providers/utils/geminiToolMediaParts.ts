import type { Part } from "@google/genai";
import type { FunctionResponseImageMetadata } from "@/types/provider/interfaces";
import type { StreamContext } from "@/types/stream/interfaces";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";
import { log } from "@/utils/misc/logger";
import { unseenToolImageNotice } from "@/providers/utils/strictChatCompat";

export interface ToolResponseMediaInput {
  /** Adapter name used in the skip log, e.g. `GoogleStreamAdapter`. */
  adapterName: string;
  imageMetadata?: FunctionResponseImageMetadata;
  seesImages: boolean;
  messageIdMap?: StreamContext["messageIdMap"];
}

/**
 * Builds the media parts a tool response contributes to a Gemini/Vertex replay turn: the delivered
 * images, or a notice standing in for them when the model cannot see images, plus the Discord
 * message IDs the tool sent them under.
 *
 * Vertex rejects a function-response turn that also carries inline data or text, so these parts ride
 * in their own user turn; AI Studio tolerates the combined shape, and both adapters keep the
 * stricter one so a payload that works in one works in the other. A reference that cannot be
 * fetched is logged and skipped rather than failing the turn, since the tool's own response text
 * already reported what it delivered.
 */
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
