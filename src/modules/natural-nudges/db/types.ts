import { createHash } from "node:crypto";
import { z } from "zod";
import type { DecisionModelRow } from "@/types/db/schema";

export const NATURAL_NUDGE_CATEGORIES = ["ping_user", "revive_topic", "start_topic", "play_scene"] as const;
export type NaturalNudgeCategory = (typeof NATURAL_NUDGE_CATEGORIES)[number];

// The "image" entry is a sentinel alias rather than a literal tool name, so either image generator satisfies it.
export const NUDGE_TOOL_NAMES = [
  "web_search",
  "fetch_url",
  "danbooru_search_tags",
  "image",
  "generate_voice_message",
  "generate_video",
  "select_sticker_for_response",
  "create_task",
  "update_task",
  "create_thread",
  "peek_profile_picture",
  "interact_with_recent_message",
  "create_long_term_memory",
  "update_long_term_memory",
  "update_short_term_memory",
  "process_youtube_video",
] as const;
export type NudgeToolName = (typeof NUDGE_TOOL_NAMES)[number];

export const HANGING_CONVERSATION_PREREQUISITE = "hanging_conversation";
export const RELATIONSHIP_USER_PREREQUISITE = "relationship_user";
export const RECENT_MEMORY_PREREQUISITE = "recent_memory";
export const PRESENCE_ACTIVITY_PREREQUISITE = "presence_activity";
export const TWO_PERSONAS_PREREQUISITE = "two_personas";
const TOOL_PREREQUISITE_PREFIX = "tool:";

export const NUDGE_PREREQUISITE_IDS: readonly string[] = [
  HANGING_CONVERSATION_PREREQUISITE,
  RELATIONSHIP_USER_PREREQUISITE,
  RECENT_MEMORY_PREREQUISITE,
  PRESENCE_ACTIVITY_PREREQUISITE,
  TWO_PERSONAS_PREREQUISITE,
  ...NUDGE_TOOL_NAMES.map((tool) => `${TOOL_PREREQUISITE_PREFIX}${tool}`),
];

// Each category prerequisite here is already enforced in isIdleNudgeEligible, so authors do not pick it and forms
// strip it.
export const CATEGORY_IMPLIED_PREREQUISITES: Record<NaturalNudgeCategory, string | null> = {
  ping_user: RELATIONSHIP_USER_PREREQUISITE,
  revive_topic: HANGING_CONVERSATION_PREREQUISITE,
  start_topic: null,
  play_scene: TWO_PERSONAS_PREREQUISITE,
};

export function isKnownPrerequisite(id: string): boolean {
  return NUDGE_PREREQUISITE_IDS.includes(id);
}

export function prerequisiteTool(id: string): NudgeToolName | null {
  if (!id.startsWith(TOOL_PREREQUISITE_PREFIX)) return null;
  const tool = id.slice(TOOL_PREREQUISITE_PREFIX.length);
  return (NUDGE_TOOL_NAMES as readonly string[]).includes(tool) ? (tool as NudgeToolName) : null;
}

export function isNudgeToolName(name: string): name is NudgeToolName {
  return (NUDGE_TOOL_NAMES as readonly string[]).includes(name);
}

export const NATURAL_NUDGE_INTEREST_LIMIT = 8;
export const NATURAL_NUDGE_INTEREST_LABEL_MAX = 40;
export const NATURAL_NUDGE_INTEREST_DESCRIPTION_MAX = 160;

// Level 0 disables nudges entirely rather than lowering frequency, because talkativeness scales from 0 (off) to 4.
export const NATURAL_NUDGE_TALKATIVENESS_LEVELS = [0, 1, 2, 3, 4] as const;
export const DEFAULT_NATURAL_NUDGE_TALKATIVENESS = 2;

const trimmedText = (max: number) => z.string().trim().min(1).max(max);

export const naturalNudgeInterestSchema = z
  .object({
    label: trimmedText(NATURAL_NUDGE_INTEREST_LABEL_MAX),
    description: trimmedText(NATURAL_NUDGE_INTEREST_DESCRIPTION_MAX),
  })
  .strict();
export type NaturalNudgeInterest = z.infer<typeof naturalNudgeInterestSchema>;

// Bun SQL returns JSONB columns as raw text in some query shapes, so stored values must be parsed before Zod
// validation.
function parseJsonbText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export const naturalNudgeInterestsSchema = z.preprocess(
  parseJsonbText,
  z.array(naturalNudgeInterestSchema).max(NATURAL_NUDGE_INTEREST_LIMIT),
);

// Interests are compared as positional tuples because PostgreSQL JSONB reorders object keys while Zod emits them in
// schema order.
export function sameNaturalNudgeInterests(interests: readonly NaturalNudgeInterest[], stored: unknown): boolean {
  const parsed = naturalNudgeInterestsSchema.safeParse(stored);
  if (!parsed.success) return false;
  const key = (list: readonly NaturalNudgeInterest[]) =>
    JSON.stringify(list.map((interest) => [interest.label, interest.description]));
  return key(interests) === key(parsed.data);
}

export const naturalNudgeTalkativenessSchema = z.number().int().min(0).max(4);

export const IDLE_NUDGE_FREQUENCY_LEVELS = [0, 1, 2, 3] as const;
export type IdleNudgeFrequencyLevel = (typeof IDLE_NUDGE_FREQUENCY_LEVELS)[number];
const frequencyLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const DEFAULT_IDLE_NUDGE_CATEGORY_WEIGHTS: Record<NaturalNudgeCategory, number> = {
  ping_user: 30,
  revive_topic: 25,
  start_topic: 30,
  play_scene: 15,
};
export const NUDGE_ADVANCED_STEP = 5;
export const NUDGE_CATEGORY_WEIGHT_MAX = 100;
export const NUDGE_HEAT_OFFSET_MAX = 1000;
const categoryWeightSchema = z.number().int().min(0).max(NUDGE_CATEGORY_WEIGHT_MAX);
const nudgeCategoryWeightsSchema = z
  .object({
    ping_user: categoryWeightSchema,
    revive_topic: categoryWeightSchema,
    start_topic: categoryWeightSchema,
    play_scene: categoryWeightSchema,
  })
  .strict();

export const serverNaturalNudgeConfigSchema = z.object({
  server_id: z.number().int(),
  idle_nudges_enabled: z.boolean(),
  active_nudges_enabled: z.boolean(),
  channel_disc_ids: z.array(z.string()),
  llm_id: z.number().int().nullable(),
  // At most one checker column may be non-null, because both null selects the recommended Active Nudge Checker.
  checker_llm_id: z.number().int().nullable(),
  checker_decision_model_id: z.number().int().nullable(),
  idle_nudge_frequency: frequencyLevelSchema,
  active_nudge_frequency: frequencyLevelSchema,
  disabled_builtin_idle_nudges: z.array(z.string()),
  category_weights: z
    .preprocess(parseJsonbText, nudgeCategoryWeightsSchema)
    .default(DEFAULT_IDLE_NUDGE_CATEGORY_WEIGHTS),
  heat_offset: z.number().int().min(-NUDGE_HEAT_OFFSET_MAX).max(NUDGE_HEAT_OFFSET_MAX).default(0),
});
export type ServerNaturalNudgeConfig = z.infer<typeof serverNaturalNudgeConfigSchema>;

// Defaults here must match schema.sql column defaults so servers without a saved row match newly inserted rows.
export function defaultServerNaturalNudgeConfig(serverId: number): ServerNaturalNudgeConfig {
  return {
    server_id: serverId,
    idle_nudges_enabled: true,
    active_nudges_enabled: true,
    channel_disc_ids: [],
    llm_id: null,
    checker_llm_id: null,
    checker_decision_model_id: null,
    idle_nudge_frequency: 1,
    active_nudge_frequency: 1,
    disabled_builtin_idle_nudges: [],
    category_weights: { ...DEFAULT_IDLE_NUDGE_CATEGORY_WEIGHTS },
    heat_offset: 0,
  };
}

export type ServerNaturalNudgeConfigPatch = Partial<Omit<ServerNaturalNudgeConfig, "server_id">>;

export function supportsCheckerChoice(model: Pick<DecisionModelRow, "supported_primitives">): boolean {
  return (model.supported_primitives as readonly string[]).includes("choice");
}

export const CUSTOM_IDLE_NUDGE_LIMIT = 25;
export const CUSTOM_IDLE_NUDGE_TITLE_MAX = 80;
export const CUSTOM_IDLE_NUDGE_BRIEF_MAX = 1000;
export const CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX = 500;
export const CUSTOM_IDLE_NUDGE_LIST_MAX = 8;

export const customIdleNudgeInputSchema = z.object({
  category: z.enum(NATURAL_NUDGE_CATEGORIES),
  title: trimmedText(CUSTOM_IDLE_NUDGE_TITLE_MAX),
  brief: trimmedText(CUSTOM_IDLE_NUDGE_BRIEF_MAX),
  agenda_hint: z.string().trim().max(CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX).nullable(),
  prerequisites: z.array(z.string().min(1).max(64)).max(CUSTOM_IDLE_NUDGE_LIST_MAX),
  recommended_tools: z.array(z.string().min(1).max(64)).max(CUSTOM_IDLE_NUDGE_LIST_MAX),
  enabled: z.boolean(),
});
export type CustomIdleNudgeInput = z.infer<typeof customIdleNudgeInputSchema>;

export const customIdleNudgeRowSchema = customIdleNudgeInputSchema.extend({
  custom_idle_nudge_id: z.number().int(),
  server_id: z.number().int(),
});
export type CustomIdleNudgeRow = z.infer<typeof customIdleNudgeRowSchema>;

// Capped at 20 because four add actions plus 20 entries fit within Discord's 25-option select limit.
export const PERSONA_AUTHORED_IDLE_NUDGE_LIMIT = 20;
const PERSONA_AUTHORED_IDLE_NUDGE_ID_MAX = 24;
export const PERSONA_AUTHORED_IDLE_NUDGE_ID_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{1,${PERSONA_AUTHORED_IDLE_NUDGE_ID_MAX}}$`,
);

export const personaAuthoredIdleNudgeIdSchema = z.string().regex(PERSONA_AUTHORED_IDLE_NUDGE_ID_PATTERN);

const uniqueIdleNudgeListSchema = z
  .array(z.string().min(1).max(64))
  .max(CUSTOM_IDLE_NUDGE_LIST_MAX)
  .refine((values) => new Set(values).size === values.length);

const idleNudgeContentShape = {
  category: z.enum(NATURAL_NUDGE_CATEGORIES),
  title: trimmedText(CUSTOM_IDLE_NUDGE_TITLE_MAX),
  brief: trimmedText(CUSTOM_IDLE_NUDGE_BRIEF_MAX),
  agenda_hint: z.string().trim().max(CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX).nullable(),
  prerequisites: uniqueIdleNudgeListSchema,
  recommended_tools: uniqueIdleNudgeListSchema,
};

function refineIdleNudgeContent(
  value: { prerequisites: readonly string[]; recommended_tools: readonly string[] },
  ctx: z.RefinementCtx,
): void {
  if (!value.prerequisites.every(isKnownPrerequisite)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prerequisites"], message: "Unknown prerequisite" });
  }
  if (!value.recommended_tools.every(isNudgeToolName)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recommended_tools"], message: "Unknown tool" });
  }
}

export const personaAuthoredIdleNudgeDraftSchema = z
  .object(idleNudgeContentShape)
  .strict()
  .superRefine(refineIdleNudgeContent);
export type PersonaAuthoredIdleNudgeDraft = z.infer<typeof personaAuthoredIdleNudgeDraftSchema>;

export const personaAuthoredIdleNudgeSchema = z
  .object({ id: personaAuthoredIdleNudgeIdSchema, ...idleNudgeContentShape })
  .strict()
  .superRefine(refineIdleNudgeContent);
export type PersonaAuthoredIdleNudge = z.infer<typeof personaAuthoredIdleNudgeSchema>;

export const personaAuthoredIdleNudgesSchema = z.preprocess(
  parseJsonbText,
  z
    .array(personaAuthoredIdleNudgeSchema)
    .max(PERSONA_AUTHORED_IDLE_NUDGE_LIMIT)
    .refine((nudges) => new Set(nudges.map((nudge) => nudge.id)).size === nudges.length, {
      message: "Duplicate authored idle nudge id",
    }),
);

export function computePersonaNudgeFingerprint(
  personaId: number,
  content: Omit<PersonaAuthoredIdleNudgeDraft, "prerequisites" | "recommended_tools"> & {
    prerequisites: readonly string[];
    recommended_tools: readonly string[];
  },
): string {
  return createHash("sha256")
    .update(
      `persona-nudge:${personaId}:${JSON.stringify([
        content.category,
        content.title,
        content.brief,
        content.agenda_hint,
        content.prerequisites,
        content.recommended_tools,
      ])}`,
    )
    .digest("base64url")
    .slice(0, 8);
}

export function computePersonaNudgeListFingerprint(
  personaId: number,
  idleNudges: readonly PersonaAuthoredIdleNudge[],
): string {
  return createHash("sha256")
    .update(
      `persona-nudges:${personaId}:${JSON.stringify(
        idleNudges.map((nudge) => [
          nudge.id,
          nudge.category,
          nudge.title,
          nudge.brief,
          nudge.agenda_hint,
          nudge.prerequisites,
          nudge.recommended_tools,
        ]),
      )}`,
    )
    .digest("base64url")
    .slice(0, 8);
}

export const personaNaturalNudgeConfigSchema = z.object({
  persona_id: z.number().int(),
  talkativeness: naturalNudgeTalkativenessSchema,
  interests: naturalNudgeInterestsSchema,
  idle_nudges: personaAuthoredIdleNudgesSchema,
  disabled_idle_nudge_ids: z.preprocess(parseJsonbText, z.array(personaAuthoredIdleNudgeIdSchema)),
  // True whenever a config row exists, because an unforked pointer can hold a row with null authored_idle_nudges.
  has_override: z.boolean(),
  // False on a pointer means authored_idle_nudges is null, so the persona still reads the preset list live.
  idle_nudges_override: z.boolean(),
  idle_nudges_inherited: z.boolean(),
});
export type PersonaNaturalNudgeConfig = z.infer<typeof personaNaturalNudgeConfigSchema>;

export const CUSTOM_IDLE_NUDGE_KEY_PREFIX = "custom:";

// Fire rows and persona scopes persist this key format, so it must stay stable for a custom idle nudge's lifetime.
export function customIdleNudgeKey(customIdleNudgeId: number): string {
  return `${CUSTOM_IDLE_NUDGE_KEY_PREFIX}${customIdleNudgeId}`;
}

export const PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX = "persona:";

// Runtime keys include personaId because preset local IDs can repeat across personas on the same or different
// servers.
export function personaAuthoredIdleNudgeKey(personaId: number, idleNudgeId: string): string {
  return `${PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX}${personaId}:${idleNudgeId}`;
}

export const personaScopeRowSchema = z.object({
  idle_nudge_key: z.string(),
  persona_ids: z.preprocess(parseJsonbText, z.array(z.number().int()).min(1)),
});

// Absent map keys leave the idle nudge open to every persona, so present keys restrict it to those persona IDs.
export type IdleNudgePersonaScopes = ReadonlyMap<string, readonly number[]>;

// Scope uses null to mean all current and future personas, because an explicit ID array would exclude personas
// created later.
export type IdleNudgeAvailability = { enabled: false } | { enabled: true; scope: readonly number[] | null };

export const runtimeStateSchema = z.object({
  server_id: z.number().int(),
  idle_nudge_jitter: z.number(),
  consecutive_failures: z.number().int(),
  stopped_at: z.date().nullable(),
});
export type NaturalNudgeRuntimeState = z.infer<typeof runtimeStateSchema>;

export const fireRowSchema = z.object({
  fire_id: z.coerce.number().int(),
  server_id: z.number().int(),
  channel_disc_id: z.string(),
  persona_id: z.number().int(),
  mode: z.enum(["active", "idle"]),
  category: z.enum(NATURAL_NUDGE_CATEGORIES).nullable(),
  idle_nudge_key: z.string().nullable(),
  target_user_id: z.number().int().nullable(),
  opener_message_disc_id: z.string(),
  answered: z.boolean().nullable(),
  fired_at: z.date(),
});
export type NaturalNudgeFireRow = z.infer<typeof fireRowSchema>;

export interface NewFireRow {
  serverId: number;
  channelDiscId: string;
  personaId: number;
  category: NaturalNudgeCategory;
  idleNudgeKey: string;
  topic: string;
  targetUserId: number | null;
  openerMessageDiscId: string;
}

export interface NewActiveNudgeFireRow {
  serverId: number;
  channelDiscId: string;
  personaId: number;
  openerMessageDiscId: string;
  detour: boolean;
}

export const pingUserCandidateSchema = z.object({
  user_id: z.number().int(),
  user_disc_id: z.string(),
  privacy_level: z.number().int(),
  local_turns: z.coerce.number().int(),
  ltm_recent: z.coerce.number().int(),
});
export type PingUserCandidate = z.infer<typeof pingUserCandidateSchema>;

// The 500 limit matches the DB CHECK constraint and planner schema bound, so changing one requires updating the
// others.
export const NATURAL_NUDGE_AGENDA_MAX = 500;

export const enabledIdleNudgeServerSchema = z.object({
  server_id: z.number().int(),
  server_disc_id: z.string(),
  timezone_offset: z.number().nullable(),
});
export type EnabledIdleNudgeServer = z.infer<typeof enabledIdleNudgeServerSchema>;
