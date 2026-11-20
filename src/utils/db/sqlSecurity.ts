import { userSchema, tomoriSchema, assembledServerConfigSchema, personaConfigSchema } from "../../types/db/schema";
import type { UserRow, TomoriRow, AssembledServerConfig, PersonaConfigRow } from "../../types/db/schema";
import { log } from "../misc/logger";

function schemaKeysExcluding<T>(schema: { shape: Record<string, unknown> }, exclude: string[]): Set<keyof T> {
  const excludeSet = new Set(exclude);
  return new Set(Object.keys(schema.shape).filter((k) => !excludeSet.has(k)) as (keyof T)[]);
}

const ALLOWED_USER_FIELDS = schemaKeysExcluding<UserRow>(userSchema, ["user_id", "created_at", "updated_at"]);

const ALLOWED_TOMORI_FIELDS = schemaKeysExcluding<TomoriRow>(tomoriSchema, ["persona_id", "created_at", "updated_at"]);

const ALLOWED_TOMORI_CONFIG_FIELDS = schemaKeysExcluding<AssembledServerConfig>(assembledServerConfigSchema, [
  "tomori_config_id",
  "persona_id",
  "server_id",
  "created_at",
  "updated_at",
]);

const ALLOWED_PERSONA_CONFIG_FIELDS = schemaKeysExcluding<PersonaConfigRow>(personaConfigSchema, [
  "persona_id",
  "created_at",
  "updated_at",
]);

export function validateUserFields(fields: string[]): void {
  for (const field of fields) {
    if (!ALLOWED_USER_FIELDS.has(field as keyof UserRow)) {
      const error = `Security violation: Invalid field name '${field}' for User table update. Allowed fields: ${Array.from(ALLOWED_USER_FIELDS).join(", ")}`;
      log.error(error);
      throw new Error(error);
    }
  }
}

export function validateTomoriFields(fields: string[]): void {
  for (const field of fields) {
    if (!ALLOWED_TOMORI_FIELDS.has(field as keyof TomoriRow)) {
      const error = `Security violation: Invalid field name '${field}' for Tomori table update. Allowed fields: ${Array.from(ALLOWED_TOMORI_FIELDS).join(", ")}`;
      log.error(error);
      throw new Error(error);
    }
  }
}

export function validateTomoriConfigFields(fields: string[]): void {
  for (const field of fields) {
    if (!ALLOWED_TOMORI_CONFIG_FIELDS.has(field as keyof AssembledServerConfig)) {
      const error = `Security violation: Invalid field name '${field}' for TomoriConfig table update. Allowed fields: ${Array.from(ALLOWED_TOMORI_CONFIG_FIELDS).join(", ")}`;
      log.error(error);
      throw new Error(error);
    }
  }
}

export function validatePersonaConfigFields(fields: string[]): void {
  for (const field of fields) {
    if (!ALLOWED_PERSONA_CONFIG_FIELDS.has(field as keyof PersonaConfigRow)) {
      const error = `Security violation: Invalid field name '${field}' for PersonaConfig table update. Allowed fields: ${Array.from(ALLOWED_PERSONA_CONFIG_FIELDS).join(", ")}`;
      log.error(error);
      throw new Error(error);
    }
  }
}
