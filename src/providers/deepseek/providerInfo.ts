import type { ProviderInfo } from "@/types/provider/interfaces";

export const deepseekProviderInfo: ProviderInfo = {
  name: "deepseek",
  displayName: "DeepSeek",
  aliases: [],
  // Deprecated codenames stay listed because providerFactory warns per request on anything absent
  // here, and servers configured before the V4 rename still hold them in llm_codename.
  supportedModels: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
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
