import type { ProviderInfo } from "@/types/provider/interfaces";

export const zaiProviderInfo: ProviderInfo = {
  name: "zai",
  displayName: "Z.ai",
  aliases: [],
  supportedModels: ["zai/glm-4.6v", "zai/glm-4.6v-flash", "zai/glm-4.7", "zai/glm-4.7-flash", "zai/glm-5"],
  requiresApiKey: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsImages: true,
  supportsVideos: false,
  apiFamily: "openai-compatible",
  featureSupport: {
    imageGeneration: "chat-completion",
    videoGeneration: "chat-completion",
    embeddings: false,
    structuredOutput: true,
    presetGeneration: true,
    expressionInitialization: false,
    liveTokenCounting: true,
    conversationCompaction: true,
    historyExtraction: true,
  },
  featureImplementations: {
    imageGeneration: "zai",
    videoGeneration: "zai",
    liveTokenCounting: "zai",
  },
  supportedParams: ["temperature", "topP", "topK", "frequencyPenalty", "presencePenalty", "minP"] as const,
};
