/**
 * Legacy Custom Provider Utilities
 *
 * Shared constants and helpers left over from the retired inline custom-provider setup flow.
 * User-facing setup now lives in /provider custom-endpoint and /personal custom-endpoint.
 *
 * The interactive parts of that old flow were removed once they had no callers left. What
 * remains are the constants and pure helpers that live code still imports.
 */

import { llmModelRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";

/**
 * Placeholder API key value for custom provider
 * This satisfies existing validation logic that expects a non-empty API key
 */
export const CUSTOM_ENDPOINT_PLACEHOLDER_KEY = "custom-endpoint-configured";

/**
 * Delete custom LLM entry for a server
 * Called when a server switches away from the custom provider
 *
 */
export async function deleteCustomLLMEntry(serverId: string | number): Promise<void> {
  const codename = `custom/${serverId}`;

  const deleted = await llmModelRepo.deleteLegacyCustomLlm(codename);
  if (deleted) {
    log.info(`Deleted custom LLM entry for server ${serverId}`);
  }
}
