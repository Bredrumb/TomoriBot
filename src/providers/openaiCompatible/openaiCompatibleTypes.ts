import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";
import type { ToolParameterType } from "@/types/tool/interfaces";

export interface OpenAICompatibleToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface OpenAICompatibleStreamChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index: number;
    delta?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: OpenAICompatibleToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    code?: string | number;
    message: string;
    type?: string;
  };
}

export interface OpenAICompatibleAccumulatedToolCall {
  id?: string;
  type?: string;
  functionName: string;
  functionArguments: string;
}

export interface OpenAICompatibleParameterSchema extends Record<string, unknown> {
  type: ToolParameterType;
  description?: string;
  enum?: string[];
  items?: OpenAICompatibleParameterSchema;
  properties?: Record<string, OpenAICompatibleParameterSchema>;
  required?: string[];
}

export interface OpenAICompatibleObjectSchema extends OpenAICompatibleParameterSchema {
  type: "object";
  properties: Record<string, OpenAICompatibleParameterSchema>;
  required: string[];
}

export interface OpenAICompatibleFunctionDeclaration extends Record<string, unknown> {
  name: string;
  description: string;
  parameters: OpenAICompatibleObjectSchema;
}

export interface OpenAICompatibleStreamConfig extends StreamConfig {
  endpointUrl?: string;
  seesImages?: boolean;
  seesVideos?: boolean;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  minP?: number;
  logitBias?: Record<string, number>;
}

export interface OpenAICompatibleRequestMutationArgs {
  requestBody: Record<string, unknown>;
  config: OpenAICompatibleStreamConfig;
  context: StreamContext;
}

export interface OpenAICompatibleHeaderMutationArgs {
  headers: Record<string, string>;
  config: OpenAICompatibleStreamConfig;
  context: StreamContext;
}

export interface OpenAICompatibleStreamAdapterOptions {
  providerName: string;
  adapterName: string;
  version?: string;
  localeNamespace: string;
  errorMessagePrefix: string;
  appendErrorDetailsForCodes?: readonly string[];
  placeholderApiKey?: string;
  enableSpeakerGuard?: boolean;
  /**
   * Set to `false` to omit the newline-prefixed active-persona stop string from
   * the request-level `stop` list while keeping the local speaker fallback guard.
   *
   * Useful for endpoints that legitimately emit `\n{persona}:` after a closed
   * `<think>...</think>` block at the start of an assistant turn.
   */
  includePersonaSpeakerStop?: boolean;
  preserveReasoningContent?: boolean;
  /** Set to `false` to disable stripping `<think>` blocks from content. Defaults to `true`. */
  stripThinkBlocksFromContent?: boolean;
  /** Set to `false` to discard stripped `<think>` content instead of routing it to the thought log. Defaults to `true`. */
  captureThinkBlocksAsThoughts?: boolean;
  resolveApiUrl: (config: OpenAICompatibleStreamConfig) => string;
  mutateRequestBody?: (args: OpenAICompatibleRequestMutationArgs) => Promise<void> | void;
  mutateHeaders?: (args: OpenAICompatibleHeaderMutationArgs) => Promise<void> | void;
  /** Provider-specific signal folded into the shared parameter-degradation classifier. */
  shouldRetryWithoutStop?: (statusCode: number, errorText: string) => boolean;
  /**
   * Return `false` to signal that this endpoint does not accept OpenAI-style
   * `"system"` role messages and that the assembled system instruction should
   * be injected as an in-band `"user"` turn instead.
   *
   * Defaults to `true` (system role is supported) when omitted.
   * Used by the Custom provider to handle Chatmock endpoints, which strip
   * system-role turns from the message list before forwarding to Codex CLI.
   */
  supportsSystemRole?: (apiUrl: string, model: string) => boolean;
}
