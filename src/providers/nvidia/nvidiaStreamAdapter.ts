import { OpenAICompatibleStreamAdapter } from "@/providers/openaiCompatible/openaiCompatibleStreamAdapter";
import type { OpenAICompatibleStreamConfig } from "@/providers/openaiCompatible/openaiCompatibleTypes";
import { buildNvidiaThinkingRequest } from "@/utils/provider/thinkingControl";

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
      // NIM returns an opaque mid-SSE 500 on unsupported input, so degrade only on that generic message to fail outages
      // fast.
      degradeOnOpaque5xx: true,
      // Both thinking keys can drop safely because falling back beats failing and NIM needs no reasoning_content
      // replay.
      degradationPriorityKeys: ["reasoning_effort", "chat_template_kwargs"],
      resolveApiUrl: (config) => {
        if (!config.endpointUrl) {
          throw new Error("NVIDIA endpoint URL is required");
        }
        return config.endpointUrl;
      },
      mutateRequestBody: ({ requestBody, config, context }) => {
        Object.assign(
          requestBody,
          buildNvidiaThinkingRequest(context.tomoriState.config.thinking_level, config.forceReason),
        );
      },
    });
  }
}
