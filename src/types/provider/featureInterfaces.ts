import { z, type ZodType } from "zod";
import type { DecisionModelRow, TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import type { CompactRoleplaySummary } from "@/types/misc/compact";
import type { PresetExportData } from "@/types/preset/presetExport";
import type { ToolContext } from "@/types/tool/interfaces";

type EmbeddingTaskType =
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION"
  | "CLUSTERING"
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "CODE_RETRIEVAL_QUERY"
  | "QUESTION_ANSWERING"
  | "FACT_VERIFICATION";

export interface EmbeddingRequest {
  provider: string;
  apiKey: string;
  model: string;
  inputs: string[];
  taskType?: EmbeddingTaskType;
  // DB primary key for custom providers so resolution can disambiguate multiple embedding endpoints under one label,
  // falling back when omitted.
  modelId?: number;
  onUsage?: (usage: import("@/utils/text/tokenEstimate").TokenUsage) => void;
}

export interface ProviderImageInput {
  url: string;
  name?: string;
  mimeType?: string;
}

export interface StructuredImageFailureDiagnostics {
  failureStage: "image-download" | "image-decode" | "image-format" | "image-size";
  imageIndex: number;
  imageName?: string;
  imageCount: number;
  httpStatus?: number;
}

export type StructuredOutputResult<T> =
  | { success: true; data: T; skippedImages?: StructuredImageFailureDiagnostics[] }
  | {
      success: false;
      error: string;
      failure?: "transport" | "malformed" | "refusal" | "cancelled";
      httpStatus?: number;
      cause?: Error;
      diagnostics?:
        | StructuredImageFailureDiagnostics
        | {
            finishReason:
              | "stop"
              | "length"
              | "content_filter"
              | "tool_calls"
              | "insufficient_system_resource"
              | "unknown";
            inputTokens?: number;
            outputTokens?: number;
            reasoningTokens?: number;
            reasoningPresent: boolean;
            maxOutputTokens: number;
            thinkingMode: "enabled" | "disabled" | "provider-default";
            imageCount: number;
            elapsedMs: number;
            providerRequestId?: string;
          };
      malformed?: { reason: "empty" | "unparsable" | "schema"; issues?: string[] };
    };

export interface ProviderStructuredJsonRequest {
  correlationId?: string;
  abortSignal?: AbortSignal;
  onUsage?: (usage: import("@/utils/text/tokenEstimate").TokenUsage) => void;
  // Private output uses one attempt and returns safe failure metadata so callers can log failures safely.
  privateOutput?: boolean;
  apiKey: string;
  model: string;
  endpointUrl?: string;
  systemPrompt: string;
  userPrompt: string;
  images?: ProviderImageInput[];
  temperature?: number;
  maxOutputTokens?: number;
  // Omitted leaves the model's own default, because one-shot utility calls rely on that rather than overriding
  // thinking_level.
  thinkingLevel?: string;
  schemaName?: string;
}

export interface GeneratePresetParams {
  characterName: string;
  characterDescription: string;
  speechExamples: string;
  additionalInstructions?: string;
  imageBase64?: string;
  imageMimeType?: string;
  useWebSearch?: boolean;
  modelName?: string;
  existingPresetContext?: string;
  // Kept separate from existingPresetContext so the prompt labels them distinctly and the model does not read an
  // image caption as extracted card data.
  appearanceDescription?: string;
  // Pre-resolved by the caller rather than per provider so the server ceiling and model limit apply once consistently
  // across providers.
  maxOutputTokens?: number;
}

export type PresetGenerationErrorType =
  | "RATE_LIMIT"
  | "BLOCKED_CONTENT"
  | "API_KEY"
  | "CONNECTION"
  | "MODEL_ERROR"
  | "TIMEOUT"
  | "EMPTY_RESPONSE"
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "UNKNOWN";

export interface PresetGenerationResult {
  preset?: PresetExportData;
  error?: string;
  errorType?: PresetGenerationErrorType;
  failureStage?: "web_search";
  cause?: Error;
}

export interface ProviderPresetGenerationRequest {
  apiKey: string;
  locale: string;
  params: GeneratePresetParams;
  tomoriState: TomoriState;
  toolContext?: ToolContext;
  maxToolRounds?: number;
  onUsage?: (usage: import("@/utils/text/tokenEstimate").TokenUsage) => void;
}

export interface ProviderCompactSummaryRequest {
  apiKey: string;
  model: string;
  endpointUrl?: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  images?: ProviderImageInput[];
  onUsage?: (usage: import("@/utils/text/tokenEstimate").TokenUsage) => void;
}

export interface CompactConversationResult {
  summary?: string;
  error?: string;
  cause?: Error;
}

export interface CompactRoleplayResult {
  summary?: CompactRoleplaySummary;
  error?: string;
  cause?: Error;
}

interface ProviderLiveTokenCountRequest {
  apiKey: string;
  tomoriState: TomoriState;
  contextItems: StructuredContextItem[];
}

interface ProviderLiveTokenCountResult {
  providerLabel: string;
  model: string;
  inputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

interface ProviderNativeImageReference {
  mimeType: string;
  data: string;
}

type ImageGenerationRequest = {
  prompt: string;
  negativePrompt?: string | null;
  referenceImageDataUrl?: string | null;
  inpaint?: boolean;
  maskPrompt?: string | null;
  maskThreshold?: number | null;
  maskGrow?: number | null;
  maskFeather?: number | null;
  cfg?: number | null;
  denoise?: number | null;
  referenceDenoise?: number | null;
  seed?: number | null;
};

export interface ProviderNativeImageGenerationRequest extends ImageGenerationRequest {
  apiKey: string;
  model: string;
  aspectRatio: string;
  endpointUrl?: string;
  referenceImages?: ProviderNativeImageReference[];
}

export interface ProviderNativeImageGenerationResult {
  imageData: string | null;
  mimeType: string | null;
  diagnosticImages?: Array<{
    label: string;
    imageData: string;
    mimeType: string;
    filename?: string;
    details?: string;
  }>;
}

export interface SupportsEmbeddings {
  generateEmbeddings(request: EmbeddingRequest): Promise<number[][]>;
  supportsEmbeddingTaskType(): boolean;
}

export interface SupportsStructuredOutput {
  callStructuredJSON<T>(
    request: ProviderStructuredJsonRequest,
    responseSchema: Record<string, unknown>,
    zodSchema: ZodType<T>,
  ): Promise<StructuredOutputResult<T>>;
  getExpressionInitializationBatchSize?(): number | null;
}

export interface SupportsPresetGeneration {
  generatePreset(request: ProviderPresetGenerationRequest): Promise<PresetGenerationResult>;
}

export interface SupportsConversationCompaction {
  generateConversationSummary(request: ProviderCompactSummaryRequest): Promise<CompactConversationResult>;
  generateRoleplaySummary(request: ProviderCompactSummaryRequest): Promise<CompactRoleplayResult>;
}

export interface SupportsLiveTokenCounting {
  measureInputTokens(request: ProviderLiveTokenCountRequest): Promise<ProviderLiveTokenCountResult>;
}

export interface SupportsNativeImageGeneration {
  generateNativeImage(request: ProviderNativeImageGenerationRequest): Promise<ProviderNativeImageGenerationResult>;
}

interface ProviderNativeVideoReference {
  mimeType: string;
  // Base64 fallback used when url is absent.
  data: string;
  // Preferred over base64 data for remote APIs so large images do not exceed request body size limits.
  url?: string;
  fallbackUrl?: string;
}

export type ProviderNativeVideoResolution = "480p" | "720p" | "1080p";

export interface ProviderNativeVideoGenerationRequest {
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
  durationSeconds?: number;
  // Optional because hosted providers (Google, OpenRouter, Z.ai) ignore FPS, while custom ComfyUI workflows consume
  // it via TOMORI_VIDEO_FPS.
  fps?: number;
  resolution?: ProviderNativeVideoResolution;
  endpointUrl?: string;
  referenceImages?: ProviderNativeVideoReference[];
  generateAudio?: boolean;
  audioPrompt?: string;
  loop?: boolean;
  // Turn-level /kill stops only local polling, because hosted video jobs keep running remotely and may still bill.
  abortSignal?: AbortSignal;
}

export interface ProviderNativeVideoGenerationResult {
  // Raw MP4 bytes rather than base64 because video payloads are too large.
  videoData: Buffer | null;
  mimeType: string | null;
  filename?: string;
  durationSeconds?: number;
  costUsd?: number;
  // Provider job identifier used to deduplicate cost tracking so repeated polling records usage only once.
  providerRequestId?: string;
}

export interface SupportsNativeVideoGeneration {
  generateNativeVideo(request: ProviderNativeVideoGenerationRequest): Promise<ProviderNativeVideoGenerationResult>;
}

export interface ProviderCapabilityMap {
  decisions: SupportsDecisions;
  embeddings: SupportsEmbeddings;
  structuredOutput: SupportsStructuredOutput;
  presetGeneration: SupportsPresetGeneration;
  conversationCompaction: SupportsConversationCompaction;
  liveTokenCounting: SupportsLiveTokenCounting;
  imageGeneration: SupportsNativeImageGeneration;
  videoGeneration: SupportsNativeVideoGeneration;
}

export type ProviderCapabilityName = keyof ProviderCapabilityMap;

export type DecisionApiStyle = "google-decisions" | "openrouter-decisions" | "system-one" | "openai-decisions";

export const decisionModelReferenceSchema = z
  .object({
    provider: z.string().regex(/^(google|openrouter|custom:[1-9][0-9]*)$/),
    modelId: z.number().int().positive(),
    // Null sentinel represents a global catalog row or custom endpoint, since only scoped registrations carry a
    // positive ID.
    registrationId: z.number().int().positive().nullable(),
    customEndpointId: z.number().int().positive().nullable(),
  })
  .refine((reference) =>
    reference.provider === "google"
      ? reference.customEndpointId === null && reference.registrationId === null
      : reference.provider === "openrouter"
        ? reference.customEndpointId === null
        : reference.customEndpointId !== null && reference.registrationId === null,
  );
export type DecisionModelReference = z.infer<typeof decisionModelReferenceSchema>;

export interface DecisionModelOption {
  model: DecisionModelRow;
  reference: DecisionModelReference;
}

interface DecisionPredicateQuestion {
  type: "predicate";
  id: string;
  instructions: string;
}

// Option IDs are subject to the same format constraint as question IDs: both must match the same pattern.
interface DecisionChoiceQuestion {
  type: "choice";
  id: string;
  instructions: string;
  options: ReadonlyArray<{ id: string; description: string }>;
}

type DecisionQuestion = DecisionPredicateQuestion | DecisionChoiceQuestion;

export interface DecisionInput {
  evidence: string;
  questions: readonly DecisionQuestion[];
  abortSignal?: AbortSignal;
  // Must fire before verdict validation and even on late cancelled responses, so provider token spend is not lost on
  // invalid or aborted verdicts.
  onUsage?: (usage: DecisionUsage) => void;
}

export interface ProviderDecisionRequest extends DecisionInput {
  reference: DecisionModelReference;
  model: string;
  inputTokenLimit: number;
  apiKey: string | null;
  apiStyle: DecisionApiStyle;
  endpointUrl?: string;
  correlationId: string;
}

export type DecisionAnswer =
  | { type: "predicate"; id: string; probability: number }
  | { type: "choice"; id: string; choice: string; probabilities: Record<string, number> }
  | { type: "refusal"; id: string };

export interface DecisionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
}

export type DecisionFailureCategory =
  | "http"
  | "authentication"
  | "network"
  | "timeout"
  | "malformed"
  | "unexpected"
  | "credentials";

export type DecisionResult =
  | { status: "denied"; error: Error; correlationId: string; errorLogged: false }
  | {
      status: "completed" | "refused";
      answers: DecisionAnswer[];
      usage?: DecisionUsage;
      correlationId: string;
      providerRequestId?: string;
      actualModel: string;
    }
  | { status: "cancelled" | "invalid-input"; correlationId: string; errorLogged: false }
  | {
      status: "unavailable";
      reason: "not-selected" | "unsupported" | "not-owned";
      correlationId: string;
      errorLogged: false;
    }
  | { status: "failed"; category: DecisionFailureCategory; correlationId: string; errorLogged: true; cause?: Error };

export interface SupportsDecisions {
  callDecisions(request: ProviderDecisionRequest): Promise<DecisionResult>;
}
