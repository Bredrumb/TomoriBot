import { OpenAICompatibleStreamAdapter } from "@/providers/openaiCompatible/openaiCompatibleStreamAdapter";
import type { OpenAICompatibleStreamConfig } from "@/providers/openaiCompatible/openaiCompatibleTypes";
import { normalizeZaiRequestSamplingParams } from "@/providers/zai/zaiRequestParams";
import { buildZaiThinkingRequest } from "@/utils/provider/thinkingControl";

export interface ZaicodingStreamConfig extends OpenAICompatibleStreamConfig {
  endpointUrl: string;
}

/**
 * Stream adapter for the Z.ai Coding API.
 * Handles reasoning content preservation, tool_stream flag, and output prefill.
 */
export class ZaicodingStreamAdapter extends OpenAICompatibleStreamAdapter {
  constructor() {
    super({
      providerName: "zaicoding",
      adapterName: "ZaicodingStreamAdapter",
      localeNamespace: ["genai", "zai"].join("."),
      errorMessagePrefix: "Z.ai API error",
      preserveReasoningContent: true,
      resolveApiUrl: (config) => {
        if (!config.endpointUrl) {
          throw new Error("Z.ai endpoint URL is required");
        }
        return config.endpointUrl;
      },
      mutateRequestBody: ({ requestBody, config, context }) => {
        const thinkingRequest = buildZaiThinkingRequest(context.tomoriState.config.thinking_level, config.forceReason);
        if (thinkingRequest.thinking) {
          requestBody.thinking = thinkingRequest.thinking;
        }
        if (thinkingRequest.omitSampling) {
          delete requestBody.temperature;
          delete requestBody.top_p;
          delete requestBody.presence_penalty;
          delete requestBody.frequency_penalty;
        }
        normalizeZaiRequestSamplingParams(requestBody);

        if (Array.isArray(requestBody.tools) && requestBody.tools.length > 0) {
          requestBody.tool_stream = true;
        }
        // Assistant prefix-completion is applied by the shared seam in
        // OpenAICompatibleStreamAdapter (providerRequiresPrefixCompletion → "zaicoding").
      },
    });
  }
}
