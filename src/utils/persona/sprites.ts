import { normalizeRenderModifierName } from "@/utils/discord/renderModifierParser";

const RENDER_MODIFIER_MAX_LENGTH = 64;
const DEFAULT_MAX_SPRITES_PER_PERSONA = 50;
const DEFAULT_MAX_PROMPT_SPRITES = 20;
const DEFAULT_MAX_INSTRUCTIONS_LENGTH = 300;
const MAX_DB_INSTRUCTIONS_LENGTH = 1000;
const INVISIBLE_FORMAT_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const DISALLOWED_RENDER_MODIFIER_CHARS = /[:：()（）\r\n]/u;

function parseLimit(name: string, fallback: number, minimum: number, maximum?: number): number {
  const rawValue = process.env[name]?.trim();
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const boundedMinimum = Math.max(minimum, parsed);
  return maximum ? Math.min(maximum, boundedMinimum) : boundedMinimum;
}

export const PERSONA_SPRITE_LIMITS = {
  MAX_NAME_LENGTH: RENDER_MODIFIER_MAX_LENGTH,
  MAX_INSTRUCTIONS_LENGTH: parseLimit(
    "PERSONA_SPRITE_MAX_INSTRUCTIONS_LENGTH",
    DEFAULT_MAX_INSTRUCTIONS_LENGTH,
    1,
    MAX_DB_INSTRUCTIONS_LENGTH,
  ),
  MAX_PER_PERSONA: parseLimit("PERSONA_SPRITE_MAX_PER_PERSONA", DEFAULT_MAX_SPRITES_PER_PERSONA, 1),
  PROMPT_MAX_COUNT: parseLimit("PERSONA_SPRITE_PROMPT_MAX_COUNT", DEFAULT_MAX_PROMPT_SPRITES, 1),
  MAX_OPTIONS_PER_GROUP: 10,
  MAX_GROUPS_PER_MODAL: 5,
  get MAX_REMOVAL_ENTRIES_PER_PAGE() {
    return this.MAX_OPTIONS_PER_GROUP * this.MAX_GROUPS_PER_MODAL;
  },
} as const;

export type PersonaSpriteNameValidation =
  | {
      ok: true;
      displayName: string;
      spriteKey: string;
    }
  | {
      ok: false;
      reason: "empty" | "too_long" | "invalid_chars";
    };

export function normalizePersonaSpriteDisplayName(value: string): string {
  return replaceControlCharacters(value).replace(INVISIBLE_FORMAT_CHARS, "").replace(/\s+/g, " ").trim();
}

export function normalizePersonaSpriteKey(value: string): string {
  return normalizeRenderModifierName(normalizePersonaSpriteDisplayName(value));
}

export function validatePersonaSpriteName(value: string): PersonaSpriteNameValidation {
  if (DISALLOWED_RENDER_MODIFIER_CHARS.test(value)) {
    return { ok: false, reason: "invalid_chars" };
  }

  const displayName = normalizePersonaSpriteDisplayName(value);
  const visibleName = displayName.replace(INVISIBLE_FORMAT_CHARS, "").trim();
  if (!visibleName) {
    return { ok: false, reason: "empty" };
  }

  if (displayName.length > PERSONA_SPRITE_LIMITS.MAX_NAME_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  const spriteKey = normalizePersonaSpriteKey(displayName);
  if (!spriteKey) {
    return { ok: false, reason: "empty" };
  }

  return {
    ok: true,
    displayName,
    spriteKey,
  };
}

export function normalizePersonaSpriteInstructions(value?: string | null): string {
  return replaceControlCharacters(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPersonaSpriteInstructionsTooLong(value: string): boolean {
  return normalizePersonaSpriteInstructions(value).length > PERSONA_SPRITE_LIMITS.MAX_INSTRUCTIONS_LENGTH;
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character;
  }).join("");
}
