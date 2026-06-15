export const NVIDIA_CHAT_COMPLETIONS_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";
export const NVIDIA_EMBEDDINGS_URL = "https://integrate.api.nvidia.com/v1/embeddings";
export const NVIDIA_IMAGE_GENERATION_URL = "https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-3-medium";

export const NVIDIA_DEFAULT_TEXT_MODEL = "meta/llama-3.3-70b-instruct";
export const NVIDIA_DEFAULT_EMBEDDING_MODEL = "nv-embed-v1";
export const NVIDIA_DEFAULT_IMAGE_MODEL = "stabilityai/stable-diffusion-3-medium";

export const NVIDIA_STRUCTURED_OUTPUT_MODELS = new Set([
  "deepseek-ai/deepseek-v3.2",
  "qwen/qwen3.5-397b-a17b",
  "z.ai/glm-4.7",
]);

export const NVIDIA_STRUCTURED_OUTPUT_VISION_MODELS = new Set(["qwen/qwen3.5-397b-a17b"]);

export const NVIDIA_IMAGE_ASPECT_RATIO_MAP: Record<string, string> = {
  "1:1": "1:1",
  "2:3": "2:3",
  "3:2": "3:2",
  "3:4": "3:4",
  "4:3": "4:3",
  "4:5": "4:5",
  "5:4": "5:4",
  "9:16": "9:16",
  "16:9": "16:9",
  "21:9": "16:9",
};
