import { ApiError, type Content, type GenerateContentConfig, type GoogleGenAI, type Part } from "@google/genai";
import { log } from "@/utils/misc/logger";

// Gemini rejects the whole request when one image fails to decode and does not say which, so the retry drops them all.
const UNPROCESSABLE_IMAGE_MESSAGE = "Unable to process input image";

function isUnprocessableImageError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400 && error.message.includes(UNPROCESSABLE_IMAGE_MESSAGE);
}

function isImagePart(part: Part): boolean {
  return Boolean(part.inlineData?.mimeType?.startsWith("image/") || part.fileData?.mimeType?.startsWith("image/"));
}

function replaceImagePartsWithNotice(contents: Content[]): { contents: Content[]; removed: number } {
  let removed = 0;
  const replaced = contents.map((content) => {
    const parts = content.parts ?? [];
    const imageCount = parts.filter(isImagePart).length;
    if (imageCount === 0) return content;
    removed += imageCount;
    const kept = parts.filter((part) => !isImagePart(part));
    const label = imageCount === 1 ? "An attached image was" : `${imageCount} attached images were`;
    kept.splice(parts.findIndex(isImagePart), 0, {
      text: `[System: ${label} removed because the model could not process it. Do not guess or claim to see the image contents.]`,
    });
    return { ...content, parts: kept };
  });
  return { contents: replaced, removed };
}

export async function generateGeminiStreamWithImageFallback(
  genAI: GoogleGenAI,
  request: { model: string; contents: Content[]; config: GenerateContentConfig },
  options: {
    adapterName: string;
    provider: string;
    onFallback?: (contents: Content[], removed: number) => void;
  },
) {
  try {
    return await genAI.models.generateContentStream(request);
  } catch (error) {
    if (!isUnprocessableImageError(error)) throw error;
    const fallback = replaceImagePartsWithNotice(request.contents);
    if (fallback.removed === 0) throw error;
    options.onFallback?.(fallback.contents, fallback.removed);
    log.warn(
      `${options.adapterName}: Gemini could not process an input image; retrying without ${fallback.removed} image(s)`,
      error,
      { metadata: { model: request.model } },
    );
    log.metric("provider_image_strip_retry", {
      provider: options.provider,
      model: request.model,
      removed: fallback.removed,
    });
    return await genAI.models.generateContentStream({ ...request, contents: fallback.contents });
  }
}
