export const MAX_TAGS = Number.parseInt(process.env.IMAGE_TAG_MAX_TAGS || "100", 10);
export const MAX_TAG_LENGTH = Number.parseInt(process.env.IMAGE_TAG_MAX_TAG_LENGTH || "200", 10);
export const TAGS_MODAL_MAX_LENGTH = 4000;

export type ImageTagValidationResult =
  | { isValid: true; tags: string[] }
  | {
      isValid: false;
      reason: "empty" | "too_many" | "tag_too_long";
    };

/**
 * Formats stored tag arrays back into the comma-separated modal format.
 */
export function formatImageTagsForModalValue(tags: string[] | null | undefined): string | undefined {
  const modalValue =
    tags
      ?.map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .join(", ") ?? "";

  return modalValue.length > 0 ? modalValue : undefined;
}

/**
 * Splits a comma-separated tag input, trims whitespace, and preserves first-seen order
 * while removing duplicates.
 */
export function parseAndValidateImageTags(tagsInput: string): ImageTagValidationResult {
  const parsedTags = tagsInput
    .split(/[,\u3001]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  const uniqueTags: string[] = [];
  const seenTags = new Set<string>();

  for (const tag of parsedTags) {
    if (!seenTags.has(tag)) {
      seenTags.add(tag);
      uniqueTags.push(tag);
    }
  }

  if (uniqueTags.length === 0) {
    return { isValid: false, reason: "empty" };
  }

  if (uniqueTags.length > MAX_TAGS) {
    return { isValid: false, reason: "too_many" };
  }

  for (const tag of uniqueTags) {
    if (tag.length > MAX_TAG_LENGTH) {
      return { isValid: false, reason: "tag_too_long" };
    }
  }

  return {
    isValid: true,
    tags: uniqueTags,
  };
}
