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

interface OpenAICompatibleParameterSchema extends Record<string, unknown> {
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

interface OpenAICompatibleRequestMutationArgs {
  requestBody: Record<string, unknown>;
  config: OpenAICompatibleStreamConfig;
  context: StreamContext;
}

interface OpenAICompatibleHeaderMutationArgs {
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
  placeholderApiKey?: string;
  enableSpeakerGuard?: boolean;
  // Disabling this omits the request stop sequence while keeping the local speaker guard, so endpoints emitting
  // \n{persona}: after <think> work.
  includePersonaSpeakerStop?: boolean;
  preserveReasoningContent?: boolean;
  // Distinct from preserveReasoningContent because DeepSeek is the only endpoint proven to require reasoning_content
  // on replayed tool turns and accept "".
  requiresReasoningContentReplay?: boolean;
  // Body keys never dropped by degradation (beyond model/messages/stream), because dropping shape keys such as
  // thinking omits reasoning_content needed for replay.
  mandatoryBodyKeys?: readonly string[];
  // Off by default because 5xx usually signals an outage; enable only for backends returning content-free 5xx for bad
  // keys so descriptive outages fail fast.
  degradeOnOpaque5xx?: boolean;
  // Body keys injected by mutateRequestBody in probe order, because unrecognized keys sort into the degradation tail
  // and become unreachable during probing.
  degradationPriorityKeys?: readonly string[];
  stripThinkBlocksFromContent?: boolean;
  captureThinkBlocksAsThoughts?: boolean;
  resolveApiUrl: (config: OpenAICompatibleStreamConfig) => string;
  mutateRequestBody?: (args: OpenAICompatibleRequestMutationArgs) => Promise<void> | void;
  mutateHeaders?: (args: OpenAICompatibleHeaderMutationArgs) => Promise<void> | void;
  shouldRetryWithoutStop?: (statusCode: number, errorText: string) => boolean;
  // Custom endpoints such as Chatmock strip system-role turns before Codex CLI, so returning false (default true)
  // switches instructions to a user turn.
  supportsSystemRole?: (apiUrl: string, model: string) => boolean;
}
