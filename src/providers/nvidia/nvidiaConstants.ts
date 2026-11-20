export const NVIDIA_CHAT_COMPLETIONS_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_EMBEDDINGS_URL = "https://integrate.api.nvidia.com/v1/embeddings";
export const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";
// Image generation uses ai.api.nvidia.com because NVIDIA kept those models on the NVCF gateway rather than moving
// them to integrate.api.nvidia.com.
export const NVIDIA_IMAGE_GENERATION_BASE_URL = "https://ai.api.nvidia.com/v1/genai";

export const NVIDIA_DEFAULT_TEXT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
// NIM refuses a bad key within a second, so a key-validation probe still waiting here has passed auth.
export const NVIDIA_KEY_VALIDATION_TIMEOUT_MS = 15000;
export const NVIDIA_DEFAULT_EMBEDDING_MODEL = "nvidia/nemotron-3.5-embed-1b";
export const NVIDIA_STRUCTURED_OUTPUT_MODELS = new Set([
  "z-ai/glm-5.3",
  "openai/gpt-oss-20b",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3-ultra-550b-a55b",
]);

export const NVIDIA_STRUCTURED_OUTPUT_VISION_MODELS = new Set(["qwen/qwen3.5-397b-a17b"]);

// NVIDIA runs these models on speculative decoding backends that reject min_p, so callers omit min_p for them.
export const NVIDIA_MIN_P_UNSUPPORTED_MODELS = new Set(["nvidia/nemotron-3-ultra-550b-a55b"]);
