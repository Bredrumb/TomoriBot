import { OpenAICompatibleStreamAdapter } from "@/providers/openaiCompatible/openaiCompatibleStreamAdapter";
import type { OpenAICompatibleStreamConfig } from "@/providers/openaiCompatible/openaiCompatibleTypes";
import { NVIDIA_THINKING_BUDGET_TOKENS, NVIDIA_THINKING_MODELS } from "@/providers/nvidia/nvidiaConstants";

export interface NvidiaStreamConfig extends OpenAICompatibleStreamConfig {
  endpointUrl: string;
}

export class NvidiaStreamAdapter extends OpenAICompatibleStreamAdapter {
  constructor() {
    super({
      providerName: "nvidia",
      adapterName: "NvidiaStreamAdapter",
      localeNamespace: ["genai", "nvidia"].join("."),
      errorMessagePrefix: "NVIDIA API error",
      resolveApiUrl: (config) => {
        if (!config.endpointUrl) {
          throw new Error("NVIDIA endpoint URL is required");
        }
        return config.endpointUrl;
      },
      mutateRequestBody: ({ requestBody, config }) => {
        // Nemotron-style thinking models need reasoning_budget + chat_template_kwargs
        // to activate extended thinking mode; the backend ignores them for non-thinking requests.
        if (config.model && NVIDIA_THINKING_MODELS.has(config.model)) {
          requestBody.reasoning_budget = NVIDIA_THINKING_BUDGET_TOKENS;
          requestBody.chat_template_kwargs = { enable_thinking: true };
        }
      },
    });
  }
}
