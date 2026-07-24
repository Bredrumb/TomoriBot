/**
 * Legacy Custom Provider Utilities
 *
 * Shared constants and helpers left over from the retired inline custom-provider setup flow.
 * Phase 3 moved user-facing setup to /provider custom-endpoint and /personal custom-endpoint.
 *
 * The interactive parts of that old flow (`promptCustomCapabilities`, `promptOtherModelConfig`,
 * `saveCustomEndpointConfig` and their private `createCustomLLMEntry` helper) were removed in
 * 2026-07 after an audit found they had no callers left anywhere in the codebase. What remains
 * are the constants and pure helpers that live code still imports.
 */

import type { McpUrlValidationResult } from "@/utils/mcp/mcpUrlSecurity";
import { llmModelRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { isCustomProvider as isCustomProviderHelper } from "@/utils/provider/customProviderUtils";

/**
 * Placeholder API key value for custom provider
 * This satisfies existing validation logic that expects a non-empty API key
 */
export const CUSTOM_ENDPOINT_PLACEHOLDER_KEY = "custom-endpoint-configured";

/**
 * Delete custom LLM entry for a server
 * Called when a server switches away from the custom provider
 *
 * @param serverId - Server ID to find and delete the custom model for
 */
export async function deleteCustomLLMEntry(serverId: string | number): Promise<void> {
  const codename = `custom/${serverId}`;

  const deleted = await llmModelRepo.deleteLegacyCustomLlm(codename);
  if (deleted) {
    log.info(`Deleted custom LLM entry for server ${serverId}`);
  }
}

/**
 * Check if a provider is the custom provider
 *
 * @param provider - Provider name to check
 * @returns boolean - True if the provider is "custom"
 */
export function isCustomProvider(provider: string): boolean {
  return isCustomProviderHelper(provider);
}

/**
 * Validate custom endpoint URL format (lightweight sync check).
 * Use validateRemoteMcpUrl() from mcpUrlSecurity for the full security gate.
 *
 * @param url - The URL to validate
 * @returns boolean - True if the URL appears to be a valid endpoint
 */
export function validateEndpointUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Must be http or https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Maps a McpUrlValidationResult failure code to the appropriate locale keys
 * for the custom provider endpoint URL error messages.
 *
 * @param validation - The failed validation result from validateRemoteMcpUrl()
 * @returns Locale key and optional variable substitutions for replyInfoEmbed
 */
export function getCustomEndpointValidationMessage(validation: McpUrlValidationResult): {
  descriptionKey: string;
  descriptionVars?: Record<string, string>;
} {
  switch (validation.failureCode) {
    case "INVALID_PROTOCOL":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_protocol_description",
      };
    case "PRODUCTION_HTTPS_REQUIRED":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_https_required_description",
      };
    case "REMOTE_HTTP_FORBIDDEN":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_http_localhost_only_description",
      };
    case "PRODUCTION_LOCALHOST_FORBIDDEN":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_localhost_blocked_description",
      };
    case "DNS_RESOLUTION_FAILED":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_dns_failed_description",
        descriptionVars: { hostname: validation.hostname ?? "unknown" },
      };
    case "PRODUCTION_BLOCKED_ADDRESS":
      return {
        descriptionKey: "commands.config.custom.endpoint_url_private_address_description",
        descriptionVars: { address: validation.blockedAddress ?? "unknown" },
      };
    default:
      // INVALID_FORMAT or unexpected codes
      return {
        descriptionKey: "commands.config.custom.endpoint_url_invalid_description",
      };
  }
}
