export interface GeminiImageReference {
  mimeType: string;
  data: string;
}

export type GeminiImagePromptPart = { inlineData: { mimeType: string; data: string } } | string;

// Reference images must be sent as inlineData parts in the PartListUnion because there is no media field and omitted
// parts are silently ignored.
export function buildGeminiImagePromptParts(
  prompt: string,
  referenceImages: readonly GeminiImageReference[] = [],
): GeminiImagePromptPart[] {
  return [...referenceImages.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } })), prompt];
}
