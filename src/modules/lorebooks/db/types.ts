import { z } from "zod";

export const LOREBOOK_SELECTIVE_LOGIC = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 } as const;
export const LOREBOOK_PLACEMENT = { BEFORE: 0, AFTER: 1 } as const;
export const LOREBOOK_TITLE_MAX = 128;
// Discord limits modal text inputs to 4,000 characters, so every stored entry must remain editable.
export const LOREBOOK_CONTENT_MAX = 4000;
export const LOREBOOK_KEYS_MAX = 20;
export const LOREBOOK_KEY_LENGTH_MAX = 64;
export const LOREBOOK_ENTRIES_PER_SCOPE_MAX = 250;
export const LOREBOOK_SCAN_DEPTH_MAX = 100;
export const LOREBOOK_DEFAULT_SCAN_DEPTH = 5;
export const LOREBOOK_DEFAULT_INSERTION_ORDER = 100;
export const LOREBOOK_CONTEXT_CHAR_BUDGET = 8000;

export function trimLorebookKey(key: string): string {
  return key.replace(/^[\s"']+|[\s"']+$/g, "");
}

export function normalizeLorebookKeys(rawKeys: readonly string[]): string[] {
  const keys = rawKeys.map(trimLorebookKey).filter((key) => key.length > 0 && key.length <= LOREBOOK_KEY_LENGTH_MAX);
  return [...new Set(keys)].slice(0, LOREBOOK_KEYS_MAX);
}

export function isLorebookRegexKey(key: string): boolean {
  return /^\/[\s\S]+\/[a-z]*$/i.test(key.trim());
}

const postgresInt = z.number().int().min(-2147483648).max(2147483647);
export const lorebookScopeSchema = z.object({
  serverId: postgresInt.positive(),
  lineageId: z.number().int().positive().nullable(),
});

const keyListSchema = z.array(z.string().max(LOREBOOK_KEY_LENGTH_MAX)).max(LOREBOOK_KEYS_MAX);
const entryFields = {
  title: z.string().trim().min(1).max(LOREBOOK_TITLE_MAX),
  content: z
    .string()
    .min(1)
    .max(LOREBOOK_CONTENT_MAX)
    .refine((value) => value.trim().length > 0),
  keys: keyListSchema,
  secondary_keys: keyListSchema,
  selective_logic: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  scan_depth: z.number().int().min(1).max(LOREBOOK_SCAN_DEPTH_MAX),
  trigger_chance: z.number().int().min(1).max(100),
  insertion_order: postgresInt,
  placement: z.union([z.literal(0), z.literal(1)]),
  constant: z.boolean(),
  enabled: z.boolean(),
  channel_disc_ids: z.array(z.string().regex(/^\d{17,20}$/)),
  legacy_channel_tags: z.array(z.string().min(1)).optional(),
};

export const lorebookEntryInputSchema = z
  .strictObject({
    ...entryFields,
    keys: keyListSchema.transform(normalizeLorebookKeys),
    secondary_keys: keyListSchema.transform(normalizeLorebookKeys),
  })
  .refine((entry) => entry.constant || entry.keys.length > 0, { path: ["keys"] });

export const lorebookEntryRowSchema = z
  .object({
    ...entryFields,
    entry_id: postgresInt.positive(),
    server_id: postgresInt.positive(),
    persona_lineage_id: z.coerce.number().int().positive().nullable(),
  })
  .refine((entry) => entry.constant || entry.keys.some((key) => key.trim().length > 0), { path: ["keys"] });

export const lorebookEntryFlagsSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    constant: z.boolean().optional(),
  })
  .refine((flags) => flags.enabled !== undefined || flags.constant !== undefined);

export type LorebookEntryRow = z.infer<typeof lorebookEntryRowSchema>;
export type LorebookEntryInput = z.infer<typeof lorebookEntryInputSchema>;
export type LorebookEntryFlags = z.infer<typeof lorebookEntryFlagsSchema>;

export function lorebookEntryToInput(row: LorebookEntryRow): LorebookEntryInput {
  const { entry_id, server_id, persona_lineage_id, ...input } = row;
  return lorebookEntryInputSchema.parse(input);
}

/** Comparable identity for duplicate detection across imports and stored rows. */
export function lorebookEntryIdentity(entry: LorebookEntryInput): string {
  return JSON.stringify(
    lorebookEntryInputSchema.parse({ ...entry, legacy_channel_tags: entry.legacy_channel_tags ?? [] }),
  );
}
