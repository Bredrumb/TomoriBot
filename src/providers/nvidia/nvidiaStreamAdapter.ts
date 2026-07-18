import { OpenAICompatibleStreamAdapter } from "@/providers/openaiCompatible/openaiCompatibleStreamAdapter";
import type { OpenAICompatibleStreamConfig } from "@/providers/openaiCompatible/openaiCompatibleTypes";
import { NVIDIA_THINKING_BUDGET_TOKENS, NVIDIA_THINKING_MODELS } from "@/providers/nvidia/nvidiaConstants";
import { resolveEffectiveThinkingLevel } from "@/utils/provider/thinkingControl";

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
      appendErrorDetailsForCodes: ["500"],
      resolveApiUrl: (config) => {
        if (!config.endpointUrl) {
          throw new Error("NVIDIA endpoint URL is required");
        }
        return config.endpointUrl;
      },
      mutateRequestBody: ({ requestBody, config, context }) => {
        // Nemotron-style thinking models use chat_template_kwargs as the source
        // of truth for toggling thinking. Do not send reasoning_budget=0 for
        // disabled thinking; the backend expects enable_thinking=false.
        if (config.model && NVIDIA_THINKING_MODELS.has(config.model)) {
          const thinkingLevel = resolveEffectiveThinkingLevel(
            context.tomoriState.config.thinking_level,
            config.forceReason,
          );
          if (thinkingLevel === "none") {
            requestBody.chat_template_kwargs = { enable_thinking: false };
            return;
          }

          requestBody.reasoning_budget = NVIDIA_THINKING_BUDGET_TOKENS;
          requestBody.chat_template_kwargs = { enable_thinking: true };
        }
      },
    });
  }
}
