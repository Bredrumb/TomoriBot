/** One reference image, in the shape every native Gemini image request accepts. */
export interface GeminiImageReference {
  mimeType: string;
  data: string;
}

/** One entry of the `PartListUnion` a Gemini image turn accepts: an inline image or the prompt. */
export type GeminiImagePromptPart = { inlineData: { mimeType: string; data: string } } | string;

/**
 * Build the message parts for a native Gemini image-generation turn: reference images first, then
 * the prompt text that describes them.
 *
 * `SendMessageParameters.message` is a `PartListUnion`, so an inline image has to travel as an
 * `inlineData` part. There is no `media` field to pass references through, and a reference that is
 * not sent as a part is silently ignored rather than rejected.
 */
export function buildGeminiImagePromptParts(
  prompt: string,
  referenceImages: readonly GeminiImageReference[] = [],
): GeminiImagePromptPart[] {
  return [...referenceImages.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } })), prompt];
}
