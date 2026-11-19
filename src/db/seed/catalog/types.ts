import type { LocaleCode } from "@/constants/locales";

// Catalog input types omit required DB defaults so optional boolean flags default to false during seeding.

export interface CatalogSection<T> {
  comment: string | string[];
  rows: T[];
}

export type ModelSection<T> = CatalogSection<T>;

interface CommonInput {
  provider: string;
  codename: string;
  desc: string | null;
  i18n?: Partial<Record<Exclude<LocaleCode, "en-US">, string>>;
  // Must be set on exactly one row per provider because the catalog validator requires a single unambiguous default.
  isDefault?: boolean;
  isDeprecated?: boolean;
}

export interface LlmInput extends CommonInput {
  // Must be set on exactly one non-deprecated row per provider so the catalog validator can resolve an active
  // flagship model.
  isSmartest?: boolean;
  isReasoning?: boolean;
  isFree?: boolean;
  hasTools?: boolean;
  seesImages?: boolean;
  seesVideos?: boolean;
  seesYoutube?: boolean;
  isUncensored?: boolean;
  supportsStructoutput?: boolean;
  // Required for anthropic (enforced by check-seed-catalogs) because the API needs consecutive same-role turns merged
  // and a leading user turn.
  strictRoleAlternation?: boolean;
  // Required for deepseek, zai, and zaicoding (enforced by check-seed-catalogs) so trailing prefill turns receive
  // prefix: true.
  supportsPrefixCompletion?: boolean;
  // Moving aliases must leave this unset because the underlying model can drop trailing assistant prefill support
  // without the row changing.
  supportsAssistantPrefill?: boolean;
  // Unit is USD per million uncached tokens, omitted for OpenRouter (live API pricing) and free models so SQL NULL
  // triggers cost fallback.
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  // Omitted for OpenRouter (live capability cache), NovelAI (tier-based limits), and custom endpoints (uses num_ctx)
  // so runtime sources govern.
  contextWindow?: number;
  // Hard provider output ceiling rather than TomoriBot's default budget, used to clamp server overrides so requests
  // are not rejected.
  maxOutputTokens?: number;
}

export interface ImageInput extends CommonInput {
  isFree?: boolean;
  isUncensored?: boolean;
}

export interface VideoInput extends CommonInput {
  isFree?: boolean;
}

export interface DecisionInput extends CommonInput {
  inputTokenLimit: number;
  seesImages?: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export interface EmbeddingInput extends CommonInput {
  // Key grouping codenames that share vector dimensionality so models with different dimensions stay separate.
  family: string;
}

// Sprite file paths resolve relative to avatarPath so pointer personas share uploaded assets, while isIdentity
// renders "sprite (Persona)" names.
export interface PresetSpriteInput {
  name: string;
  file: string;
  usageInstructions?: string;
  isIdentity?: boolean;
}

export interface PersonaInput {
  name: string;
  desc: string;
  attributes: string[];
  sampleDialoguesIn: string[];
  sampleDialoguesOut: string[];
  language: string;
  avatarPath: string;
  triggerWords: string[];
  lineageId: number;
  namingConfig: import("@/types/personaNaming").PersonaNamingConfig;
  sprites?: PresetSpriteInput[];
  // Character reference files must live in a subfolder under avatarPath because the avatar seed takes the first image
  // directly inside avatarPath.
  characterReference?: string;
  isNsfw?: boolean;
}

export interface SystemPromptInput {
  name: string;
  desc: string;
  i18n?: Partial<Record<Exclude<LocaleCode, "en-US">, string>>;
  // Localized picker labels only, because name remains both the stored identity and the en-US label.
  names?: Partial<Record<Exclude<LocaleCode, "en-US">, string>>;
  promptText: string;
}

export type NaiModelTarget = "kayra" | "erato" | "xialong";

type NaiPhraseRepPen = "off" | "light" | "medium" | "aggressive" | "very_aggressive";

interface NaiSamplingParameters {
  order?: number[];
  temperature?: number;
  max_length?: number;
  min_length?: number;
  top_k?: number;
  top_p?: number;
  top_a?: number;
  typical_p?: number;
  tail_free_sampling?: number;
  repetition_penalty?: number;
  repetition_penalty_range?: number;
  repetition_penalty_slope?: number;
  repetition_penalty_frequency?: number;
  repetition_penalty_presence?: number;
  phrase_rep_pen?: NaiPhraseRepPen;
  min_p?: number;
  mirostat_lr?: number;
  mirostat_tau?: number;
}

export interface NaiPresetInput {
  name: string;
  modelTarget: NaiModelTarget;
  isDefault?: boolean;
  desc: string;
  i18n?: Partial<Record<Exclude<LocaleCode, "en-US">, string>>;
  parameters: NaiSamplingParameters;
}

export interface SpeechInput extends CommonInput {
  voiceMode: "design" | "clone";
}

export type TranscriptionInput = CommonInput;
