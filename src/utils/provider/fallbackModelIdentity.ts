import type { CustomEndpointRow, FallbackModelRef } from "@/types/db/schema";

type FallbackIdentityEndpoint = Pick<CustomEndpointRow, "custom_endpoint_id" | "model_ref_id">;

export function getFallbackModelRefKey(ref: FallbackModelRef): string {
  return `${ref.type}:${ref.id}`;
}

/** Returns every stored ref key that resolves to the active synthetic or catalog LLM. */
export function getPrimaryFallbackRefKeys(
  primaryLlmId: number | null | undefined,
  endpoints: Iterable<FallbackIdentityEndpoint> = [],
): Set<string> {
  const keys = new Set<string>();
  if (!primaryLlmId) return keys;

  keys.add(`llm:${primaryLlmId}`);
  for (const endpoint of endpoints) {
    if (endpoint.model_ref_id === primaryLlmId && endpoint.custom_endpoint_id !== undefined) {
      keys.add(`custom_endpoint:${endpoint.custom_endpoint_id}`);
    }
  }

  return keys;
}

export function prunePrimaryFallbackRefs(
  refs: readonly FallbackModelRef[],
  primaryLlmId: number | null | undefined,
  endpoints: Iterable<FallbackIdentityEndpoint> = [],
): FallbackModelRef[] {
  const primaryKeys = getPrimaryFallbackRefKeys(primaryLlmId, endpoints);
  return refs.filter((ref) => !primaryKeys.has(getFallbackModelRefKey(ref)));
}
