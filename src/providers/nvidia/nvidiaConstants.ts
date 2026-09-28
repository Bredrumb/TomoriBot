export const NVIDIA_CHAT_COMPLETIONS_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_EMBEDDINGS_URL = "https://integrate.api.nvidia.com/v1/embeddings";
/**
 * Image generation stayed on the older per-function NVCF gateway when chat and embeddings moved to
 * the OpenAI-compatible `integrate.api.nvidia.com` surface. The full URL is `{base}/{codename}`,
 * built per model in `nvidiaImageGeneration.ts`.
 */
export const NVIDIA_IMAGE_GENERATION_BASE_URL = "https://ai.api.nvidia.com/v1/genai";

export const NVIDIA_DEFAULT_TEXT_MODEL = "deepseek-ai/deepseek-v4.1-flash";
/** NIM refuses a bad key within a second, so a key-validation probe still waiting here has passed auth. */
export const NVIDIA_KEY_VALIDATION_TIMEOUT_MS = 15000;
export const NVIDIA_DEFAULT_EMBEDDING_MODEL = "nv-embed-v1";
export const NVIDIA_STRUCTURED_OUTPUT_MODELS = new Set([
  "z-ai/glm-5.3",
  "openai/gpt-oss-20b",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3-ultra-550b-a55b",
]);

export const NVIDIA_STRUCTURED_OUTPUT_VISION_MODELS = new Set(["qwen/qwen3.5-397b-a17b"]);

/**
 * NVIDIA currently runs these models with speculative decoding backends that reject `min_p`.
 */
export const NVIDIA_MIN_P_UNSUPPORTED_MODELS = new Set(["nvidia/nemotron-3-ultra-550b-a55b"]);
