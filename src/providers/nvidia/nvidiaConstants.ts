export const NVIDIA_CHAT_COMPLETIONS_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";
export const NVIDIA_EMBEDDINGS_URL = "https://integrate.api.nvidia.com/v1/embeddings";
/**
 * Image generation stayed on the older per-function NVCF gateway when chat and embeddings moved to
 * the OpenAI-compatible `integrate.api.nvidia.com` surface. The full URL is `{base}/{codename}`,
 * built per model in `nvidiaImageGeneration.ts`.
 */
export const NVIDIA_IMAGE_GENERATION_BASE_URL = "https://ai.api.nvidia.com/v1/genai";

export const NVIDIA_DEFAULT_TEXT_MODEL = "meta/llama-3.3-70b-instruct";
export const NVIDIA_DEFAULT_EMBEDDING_MODEL = "nv-embed-v1";
export const NVIDIA_STRUCTURED_OUTPUT_MODELS = new Set([
  "deepseek-ai/deepseek-v3.2",
  "qwen/qwen3.5-397b-a17b",
  "z.ai/glm-4.7",
  "z-ai/glm-5.2",
  "minimaxai/minimax-m3",
  "moonshotai/kimi-k2.6",
  "nvidia/nemotron-3-ultra-550b-a55b",
]);

export const NVIDIA_STRUCTURED_OUTPUT_VISION_MODELS = new Set(["qwen/qwen3.5-397b-a17b"]);

/**
 * NVIDIA currently runs these models with speculative decoding backends that reject `min_p`.
 */
export const NVIDIA_MIN_P_UNSUPPORTED_MODELS = new Set(["nvidia/nemotron-3-ultra-550b-a55b"]);

/**
 * Models that require extended-thinking parameters injected at request time.
 * These receive `reasoning_budget` and `chat_template_kwargs: { enable_thinking: true }`
 * in addition to the standard chat-completion body.
 */
export const NVIDIA_THINKING_MODELS = new Set(["nvidia/nemotron-3-ultra-550b-a55b"]);

/** Default reasoning budget (tokens) for Nemotron-style thinking-enabled models. */
export const NVIDIA_THINKING_BUDGET_TOKENS = 16384;
