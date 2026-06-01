import type { ZodType } from "zod";
import type { TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import type { CompactRoleplaySummary } from "@/types/misc/compact";
import type { PresetExportData } from "@/types/preset/presetExport";
import type { ToolContext } from "@/types/tool/interfaces";

export type EmbeddingTaskType =
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
}

export interface ProviderImageInput {
  url: string;
  name?: string;
  mimeType?: string;
}

export type StructuredOutputResult<T> = { success: true; data: T } | { success: false; error: string };

export interface ProviderStructuredJsonRequest {
  apiKey: string;
  model: string;
  endpointUrl?: string;
  systemPrompt: string;
  userPrompt: string;
  images?: ProviderImageInput[];
  temperature?: number;
  maxOutputTokens?: number;
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
  /** Serialized existing card/preset data extracted from the uploaded image, used as AI reference context */
  existingPresetContext?: string;
}

export interface PresetGenerationResult {
  preset?: PresetExportData;
  error?: string;
  errorType?:
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
}

export interface ProviderPresetGenerationRequest {
  apiKey: string;
  locale: string;
  params: GeneratePresetParams;
  tomoriState: TomoriState;
  toolContext?: ToolContext;
  maxToolRounds?: number;
}

export interface ProviderCompactSummaryRequest {
  apiKey: string;
  model: string;
  endpointUrl?: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  images?: ProviderImageInput[];
}

export interface CompactConversationResult {
  summary?: string;
  error?: string;
}

export interface CompactRoleplayResult {
  summary?: CompactRoleplaySummary;
  error?: string;
}

export interface ProviderLiveTokenCountRequest {
  apiKey: string;
  tomoriState: TomoriState;
  contextItems: StructuredContextItem[];
}

export interface ProviderLiveTokenCountResult {
  providerLabel: string;
  model: string;
  inputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

export interface ProviderNativeImageReference {
  mimeType: string;
  data: string;
}

export type ImageGenerationRequest = {
  prompt: string;
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

/** Reference image input for image-to-video generation */
export interface ProviderNativeVideoReference {
  mimeType: string;
  data: string; // Base64-encoded image data (used when url is not available)
  url?: string; // Original source URL — preferred over base64 for remote APIs to avoid body size limits
}

export type ProviderNativeVideoResolution = "480p" | "720p" | "1080p";

/** Request parameters for native video generation across all providers */
export interface ProviderNativeVideoGenerationRequest {
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
  durationSeconds?: number;
  resolution?: ProviderNativeVideoResolution;
  endpointUrl?: string;
  referenceImages?: ProviderNativeVideoReference[];
  /** Whether the provider should generate audio alongside the video. Defaults to false. */
  generateAudio?: boolean;
}

/** Result of a native video generation operation */
export interface ProviderNativeVideoGenerationResult {
  videoData: Buffer | null; // Raw MP4 bytes (not base64 — videos are too large)
  mimeType: string | null;
  durationSeconds?: number;
}

export interface SupportsNativeVideoGeneration {
  generateNativeVideo(request: ProviderNativeVideoGenerationRequest): Promise<ProviderNativeVideoGenerationResult>;
}

export interface ProviderCapabilityMap {
  embeddings: SupportsEmbeddings;
  structuredOutput: SupportsStructuredOutput;
  presetGeneration: SupportsPresetGeneration;
  conversationCompaction: SupportsConversationCompaction;
  liveTokenCounting: SupportsLiveTokenCounting;
  imageGeneration: SupportsNativeImageGeneration;
  videoGeneration: SupportsNativeVideoGeneration;
}

export type ProviderCapabilityName = keyof ProviderCapabilityMap;
