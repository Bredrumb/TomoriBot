/**
 * SQL Security Utilities
 *
 * This module provides security utilities for dynamic SQL query construction,
 * particularly for validating field names in UPDATE statements to prevent SQL injection.
 *
 * Field whitelists are derived from Zod schema shapes at module load time.
 * Only primary keys, foreign keys used as table anchors, and auto-managed timestamps
 * are explicitly excluded, so all other schema fields are allowed automatically.
 * When new columns are added to a schema, they become writable here without any manual update.
 */

import { userSchema, tomoriSchema, assembledServerConfigSchema, personaConfigSchema } from "../../types/db/schema";
import type { UserRow, TomoriRow, AssembledServerConfig, PersonaConfigRow } from "../../types/db/schema";
import { log } from "../misc/logger";

/**
 * Derives an allowed-fields Set from a Zod object schema's .shape,
 * excluding the given key names (primary keys, FK anchors, auto-managed timestamps).
 */
function schemaKeysExcluding<T>(schema: { shape: Record<string, unknown> }, exclude: string[]): Set<keyof T> {
  const excludeSet = new Set(exclude);
  return new Set(Object.keys(schema.shape).filter((k) => !excludeSet.has(k)) as (keyof T)[]);
}

const ALLOWED_USER_FIELDS = schemaKeysExcluding<UserRow>(userSchema, [
  "user_id", // primary key
  "created_at",
  "updated_at",
]);

const ALLOWED_TOMORI_FIELDS = schemaKeysExcluding<TomoriRow>(tomoriSchema, [
  "persona_id", // primary key (renamed from persona_id in migration 016)
  "created_at",
  "updated_at",
]);

const ALLOWED_TOMORI_CONFIG_FIELDS = schemaKeysExcluding<AssembledServerConfig>(assembledServerConfigSchema, [
  "tomori_config_id", // primary key
  "persona_id", // FK anchor
  "server_id", // FK anchor
  "created_at",
  "updated_at",
]);

const ALLOWED_PERSONA_CONFIG_FIELDS = schemaKeysExcluding<PersonaConfigRow>(personaConfigSchema, [
  "persona_id", // FK anchor / primary key
  "created_at",
  "updated_at",
]);

/**
 * Validates that all provided field names are whitelisted for User table updates.
 * Throws an error if any field is not allowed to prevent SQL injection.
 *
 * @throws Error if any field name is not whitelisted
 */
export function validateUserFields(fields: string[]): void {
  for (const field of fields) {
    if (!ALLOWED_USER_FIELDS.has(field as keyof UserRow)) {
      const error = `Security violation: Invalid field name '${field}' for User table update. Allowed fields: ${Array.from(ALLOWED_USER_FIELDS).join(", ")}`;
      log.error(error);
      throw new Error(error);
    }
  }
}

/**
 * Validates that all provided field names are whitelisted for Tomori table updates.
 * Throws an error if any field is not allowed to prevent SQL injection.
 *
 * @throws Error if any field name is not whitelisted
 */
export function validateTomoriFields(fields: string[]): void {
  for (const field of fields) {
    if (!ALLOWED_TOMORI_FIELDS.has(field as keyof TomoriRow)) {
      const error = `Security violation: Invalid field name '${field}' for Tomori table update. Allowed fields: ${Array.from(ALLOWED_TOMORI_FIELDS).join(", ")}`;
      log.error(error);
      throw new Error(error);
    }
  }
}

/**
 * Validates that all provided field names are whitelisted for TomoriConfig table updates.
 * Throws an error if any field is not allowed to prevent SQL injection.
 *
 * @throws Error if any field name is not whitelisted
 */
export function validateTomoriConfigFields(fields: string[]): void {
  for (const field of fields) {
    if (!ALLOWED_TOMORI_CONFIG_FIELDS.has(field as keyof AssembledServerConfig)) {
      const error = `Security violation: Invalid field name '${field}' for TomoriConfig table update. Allowed fields: ${Array.from(ALLOWED_TOMORI_CONFIG_FIELDS).join(", ")}`;
      log.error(error);
      throw new Error(error);
    }
  }
}

/**
 * Validates that all provided field names are whitelisted for PersonaConfig table updates.
 * Throws an error if any field is not allowed to prevent SQL injection.
 *
 * @throws Error if any field name is not whitelisted
 */
export function validatePersonaConfigFields(fields: string[]): void {
  for (const field of fields) {
    if (!ALLOWED_PERSONA_CONFIG_FIELDS.has(field as keyof PersonaConfigRow)) {
      const error = `Security violation: Invalid field name '${field}' for PersonaConfig table update. Allowed fields: ${Array.from(ALLOWED_PERSONA_CONFIG_FIELDS).join(", ")}`;
      log.error(error);
      throw new Error(error);
    }
  }
}

/**
 * Get all allowed field names for User table (for documentation/debugging purposes)
 */
export function getAllowedUserFields(): readonly string[] {
  return Array.from(ALLOWED_USER_FIELDS);
}

/**
 * Get all allowed field names for Tomori table (for documentation/debugging purposes)
 */
export function getAllowedTomoriFields(): readonly string[] {
  return Array.from(ALLOWED_TOMORI_FIELDS);
}

/**
 * Get all allowed field names for TomoriConfig table (for documentation/debugging purposes)
 */
export function getAllowedTomoriConfigFields(): readonly string[] {
  return Array.from(ALLOWED_TOMORI_CONFIG_FIELDS);
}

/**
 * Get all allowed field names for PersonaConfig table (for documentation/debugging purposes)
 */
export function getAllowedPersonaConfigFields(): readonly string[] {
  return Array.from(ALLOWED_PERSONA_CONFIG_FIELDS);
}
