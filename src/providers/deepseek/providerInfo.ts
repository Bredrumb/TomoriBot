import type { ProviderInfo } from "@/types/provider/interfaces";

export const deepseekProviderInfo: ProviderInfo = {
  name: "deepseek",
  displayName: "DeepSeek",
  aliases: [],
  supportedModels: ["deepseek-chat", "deepseek-reasoner"],
  requiresApiKey: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsImages: false,
  supportsVideos: false,
  apiFamily: "openai-compatible",
  featureSupport: {
    imageGeneration: "none",
    videoGeneration: "none",
    embeddings: false,
    structuredOutput: true,
    presetGeneration: true,
    expressionInitialization: false,
    liveTokenCounting: true,
    conversationCompaction: true,
    historyExtraction: true,
  },
  featureImplementations: {
    liveTokenCounting: "deepseek",
  },
  supportedParams: ["temperature", "topP", "topK", "frequencyPenalty", "presencePenalty", "minP"] as const,
};
