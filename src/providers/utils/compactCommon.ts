/**
 * Shared schemas and utilities for conversation compaction generators.
 *
 * All providers that support conversation compaction (OpenRouter, Custom, DeepSeek,
 * NVIDIA, ZAI, Zaicoding) use the same roleplay summary schema. This module provides
 * a single source of truth for the JSON schema and Zod validation schema, so each
 * provider's compactGenerator.ts only needs to handle the provider-specific HTTP wiring.
 */
import { z } from "zod";

/**
 * JSON Schema for the roleplay summary structured output.
 *
 * Used by `response_format: { type: "json_schema", json_schema: { ... } }`
 * (OpenRouter, NVIDIA) or injected into the system prompt for providers
 * that only support `json_object` mode (DeepSeek, ZAI, Custom).
 */
export function buildRoleplaySchema() {
  return {
    type: "object" as const,
    properties: {
      overall_scene_summary: { type: "string" as const },
    },
    required: ["overall_scene_summary"],
  };
}

/**
 * Zod schema for validating the roleplay summary response.
 *
 * Used by providers that validate locally with Zod (DeepSeek, ZAI, Custom)
 * rather than relying on strict server-side schema enforcement.
 */
export const CompactRoleplaySummarySchema = z.object({
  overall_scene_summary: z.string(),
});
