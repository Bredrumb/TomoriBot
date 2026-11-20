import {
  lorebookEntryInputSchema,
  LOREBOOK_ENTRIES_PER_SCOPE_MAX,
  type LorebookEntryInput,
} from "@/modules/lorebooks/db/types";

import { z } from "zod";
import { MAX_VOICE_DESIGN_PROMPT_LENGTH } from "@/constants/speech";
import {
  naturalNudgeInterestsSchema,
  naturalNudgeTalkativenessSchema,
  personaAuthoredIdleNudgesSchema,
  type NaturalNudgeInterest,
  type PersonaAuthoredIdleNudge,
} from "@/modules/natural-nudges/db/types";
import {
  EMPTY_PERSONA_NAMING_CONFIG,
  personaNamingConfigSchema,
  type PersonaNamingConfig,
} from "@/types/personaNaming";

export const PRESET_EXPORT_VERSION = "1.0.0";

export type PresetImportMode = "card" | "bundle";

// Sentinel for model-only sample dialogues, so the context builder detects it and skips injecting a paired user
// example turn.
export const UNPAIRED_SAMPLE_DIALOGUE_SENTINEL = "__UNPAIRED_SAMPLE_DIALOGUE__";

export const PRESET_MAX_STRING_LENGTH = 5000;
// Four 4000-character persona prompt fields can add three two-character separators.
export const PRESET_MAX_PERSONA_PROMPT_LENGTH = 16_003;
export const PRESET_MAX_ATTRIBUTES = 200;
const PRESET_MAX_SAMPLE_DIALOGUES = 100;
const PRESET_MAX_TRIGGER_WORDS = 100;
const PRESET_MAX_IMAGE_TAGS = 200;

// Index 1 targets Appearance because generated presets follow the canonical 6-attribute layout in presetCommon.ts.
const GENERATED_PRESET_APPEARANCE_ATTRIBUTE_INDEX = 1;

export function buildPrivateAttributePublicFlags(attributeList: readonly string[]): boolean[] {
  return attributeList.map(() => false);
}

export function buildGeneratedPresetAttributePublicFlags(attributeList: readonly string[]): boolean[] {
  return attributeList.map((_attribute, index) => index === GENERATED_PRESET_APPEARANCE_ATTRIBUTE_INDEX);
}

export interface PresetExportData {
  lorebook_entries?: LorebookEntryInput[];
  tomori_nickname: string;
  attribute_list: string[];
  // Parallel to attribute_list: each boolean aligns by index so true exposes that attribute to other triggered
  // personas.
  attribute_public_flags?: boolean[];
  sample_dialogues_in: string[];
  sample_dialogues_out: string[];
  trigger_words: string[];
  persona_prompt?: string | null;
  speech_voice_design_prompt?: string | null;
  voice_source_priority?: "design" | "clone";
  naming_config?: PersonaNamingConfig;
  persona_lineage_id?: number;
  preset_lineage_id?: number;
  physical_appearance_tags?: string[];
  char_ref_url?: string | null;
  nai_attg_author?: string | null;
  nai_attg_title?: string | null;
  nai_attg_tags?: string | null;
  nai_attg_genre?: string | null;
  // Optional because ATTG quality stars (1-5) apply only to NovelAI Erato.
  nai_attg_stars?: number | null;
  // Optional because exports that predate this flag were all SFW, so absence means non-NSFW.
  is_nsfw?: boolean;
  natural_nudge_interests?: NaturalNudgeInterest[];
  natural_nudge_talkativeness?: number;
  natural_nudge_idle_nudges?: PersonaAuthoredIdleNudge[];
}

// Embedded directly in PNG tEXt chunks, so changing this envelope breaks persisted preset image exports.
export interface PresetExport {
  version: string;
  type: "preset";
  // Format: ISO 8601 timestamp.
  exported_at: string;
  data: PresetExportData;
}

export type ExportResult =
  | {
      success: true;
      data: PresetExport;
    }
  | {
      success: false;
      error: string;
    };

export type ImportResult =
  | {
      success: true;
      itemsImported: {
        nickname: string;
        attributeCount: number;
        dialogueCount: number;
        triggerWordCount: number;
      };
      mainPersonaIsPointer: boolean;
    }
  | {
      success: false;
      // Format: locale key or pipe-separated error with variables.
      error: string;
    };

export interface ValidationResult {
  valid: boolean;
  data?: PresetExportData;
  // Format: locale key or pipe-separated error.
  error?: string;
}

export const presetExportDataSchema = z.object({
  lorebook_entries: z.array(lorebookEntryInputSchema).max(LOREBOOK_ENTRIES_PER_SCOPE_MAX).optional(),
  tomori_nickname: z.string().min(1, "Nickname cannot be empty").max(100, "Nickname too long"),
  attribute_list: z.array(z.string().max(PRESET_MAX_STRING_LENGTH)).max(PRESET_MAX_ATTRIBUTES),
  attribute_public_flags: z.array(z.boolean()).max(PRESET_MAX_ATTRIBUTES).optional(),
  sample_dialogues_in: z.array(z.string().max(PRESET_MAX_STRING_LENGTH)).max(PRESET_MAX_SAMPLE_DIALOGUES),
  sample_dialogues_out: z.array(z.string().max(PRESET_MAX_STRING_LENGTH)).max(PRESET_MAX_SAMPLE_DIALOGUES),
  trigger_words: z.array(z.string().max(PRESET_MAX_STRING_LENGTH)).max(PRESET_MAX_TRIGGER_WORDS),
  persona_prompt: z.string().max(PRESET_MAX_PERSONA_PROMPT_LENGTH).nullable().optional(),
  speech_voice_design_prompt: z.string().max(MAX_VOICE_DESIGN_PROMPT_LENGTH).nullable().optional(),
  voice_source_priority: z.enum(["design", "clone"]).default("design"),
  naming_config: personaNamingConfigSchema.default(EMPTY_PERSONA_NAMING_CONFIG),
  persona_lineage_id: z
    .preprocess((value) => {
      if (typeof value === "bigint") {
        return Number(value);
      }
      if (typeof value === "string" && value.trim() !== "") {
        return Number(value);
      }
      return value;
    }, z.number().int().nonnegative())
    .optional(),
  preset_lineage_id: z
    .preprocess((value) => {
      if (typeof value === "bigint") {
        return Number(value);
      }
      if (typeof value === "string" && value.trim() !== "") {
        return Number(value);
      }
      return value;
    }, z.number().int().nonnegative())
    .optional(),
  physical_appearance_tags: z.array(z.string().max(PRESET_MAX_STRING_LENGTH)).max(PRESET_MAX_IMAGE_TAGS).optional(),
  char_ref_url: z.string().max(PRESET_MAX_STRING_LENGTH).nullable().optional(),
  nai_attg_author: z.string().max(PRESET_MAX_STRING_LENGTH).nullable().optional(),
  nai_attg_title: z.string().max(PRESET_MAX_STRING_LENGTH).nullable().optional(),
  nai_attg_tags: z.string().max(PRESET_MAX_STRING_LENGTH).nullable().optional(),
  nai_attg_genre: z.string().max(PRESET_MAX_STRING_LENGTH).nullable().optional(),
  nai_attg_stars: z.number().int().min(1).max(5).nullable().optional(),
  is_nsfw: z.boolean().optional(),
  natural_nudge_interests: naturalNudgeInterestsSchema.optional(),
  natural_nudge_talkativeness: naturalNudgeTalkativenessSchema.optional(),
  natural_nudge_idle_nudges: personaAuthoredIdleNudgesSchema.optional(),
});

// Legacy preset files still in users' hands use nai_char_ref_url, so imports must rename the key before schema
// validation.
export function renameLegacyCharRefKey(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data) || !("nai_char_ref_url" in data)) {
    return data;
  }
  const { nai_char_ref_url: legacyCharRefUrl, ...rest } = data as Record<string, unknown>;
  return "char_ref_url" in rest ? rest : { ...rest, char_ref_url: legacyCharRefUrl };
}

export const presetExportSchema = z.object({
  version: z.string(),
  type: z.literal("preset"),
  // Format: ISO 8601 timestamp.
  exported_at: z.string(),
  data: z.preprocess(renameLegacyCharRefKey, presetExportDataSchema),
});
