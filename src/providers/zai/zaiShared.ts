export const ZAI_GENERAL_CHAT_COMPLETIONS_URL = "https://api.z.ai/api/paas/v4/chat/completions";
export const ZAI_CODING_CHAT_COMPLETIONS_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
export const ZAI_GENERAL_IMAGES_GENERATIONS_URL = "https://api.z.ai/api/paas/v4/images/generations";
export const ZAI_CODING_IMAGES_GENERATIONS_URL = "https://api.z.ai/api/coding/paas/v4/images/generations";

export const ZAI_REASONING_MODELS = ["glm-5.1", "glm-5", "glm-4.7"];
export const ZAI_VISION_MODEL = "glm-4.6v";

// Z.AI general DB rows include a provider prefix such as zai/glm-4.7 to coexist with coding-endpoint rows, so it must
// be stripped for the upstream API.
export function toZaiApiModelName(model: string): string {
  const trimmed = model.trim();
  const slashIndex = trimmed.lastIndexOf("/");
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
}
