import type { CustomEndpointCapability, CustomEndpointRow } from "@/types/db/schema";

const CUSTOM_PROVIDER_PREFIX = "custom:";
const SERVER_PROVIDER_SEGMENT = "s";
const USER_PROVIDER_SEGMENT = "u";
const CUSTOM_LABEL_PATTERN = /^[a-z0-9_-]{1,40}$/;

export interface ParsedCustomProvider {
  raw: string;
  label: string;
  scope: "server" | "personal";
  ownerId: number | null;
}

export function isCustomProvider(provider: string): boolean {
  return provider.trim().toLowerCase().startsWith(CUSTOM_PROVIDER_PREFIX);
}

export function normalizeCustomEndpointLabel(label: string): string {
  return label.trim().toLowerCase();
}

export function isValidCustomEndpointLabel(label: string): boolean {
  return CUSTOM_LABEL_PATTERN.test(normalizeCustomEndpointLabel(label));
}

export function buildServerCustomProviderName(serverId: number, label: string): string {
  return `${CUSTOM_PROVIDER_PREFIX}${SERVER_PROVIDER_SEGMENT}${serverId}:${normalizeCustomEndpointLabel(label)}`;
}

export function buildUserCustomProviderName(userId: number, label: string): string {
  return `${CUSTOM_PROVIDER_PREFIX}${USER_PROVIDER_SEGMENT}${userId}:${normalizeCustomEndpointLabel(label)}`;
}

export function parseCustomProvider(provider: string): ParsedCustomProvider | null {
  const normalized = provider.trim().toLowerCase();
  if (!isCustomProvider(normalized)) {
    return null;
  }

  const payload = normalized.slice(CUSTOM_PROVIDER_PREFIX.length);
  const [scopeWithId, ...labelParts] = payload.split(":");
  const label = labelParts.join(":");

  if (!scopeWithId || !label) {
    return null;
  }

  const scopePrefix = scopeWithId.charAt(0);
  const ownerId = Number.parseInt(scopeWithId.slice(1), 10);
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    return null;
  }

  if (scopePrefix === SERVER_PROVIDER_SEGMENT) {
    return {
      raw: normalized,
      label,
      scope: "server",
      ownerId,
    };
  }

  if (scopePrefix === USER_PROVIDER_SEGMENT) {
    return {
      raw: normalized,
      label,
      scope: "personal",
      ownerId,
    };
  }

  return null;
}

export function getCustomProviderLabel(provider: string): string | null {
  return parseCustomProvider(provider)?.label ?? null;
}

export function getCustomProviderDisplayName(provider: string): string {
  const label = getCustomProviderLabel(provider);
  return label ? `Custom Endpoint: ${label}` : "Custom Endpoint";
}

function slugifyCodenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Builds the synthetic model codename for a custom endpoint.
 *
 * When a model name is supplied it is appended as a slug so several models can coexist under one
 * provider+capability with distinct codenames (e.g. `custom-s5-home-text-llama3-1-8b`). When omitted
 * (single unnamed model, e.g. KoboldCpp), the legacy `{slug}-{capability}` form is preserved so
 * pre-existing rows keep their codename. The model slug is capped to keep codenames within the
 * Discord select-option value limit when used as a picker value.
 *
 * @param provider   - Internal custom provider name (e.g. "custom:s5:home")
 * @param capability - Endpoint capability
 * @param modelName  - Optional model name used as the disambiguating suffix
 */
export function buildSyntheticCustomModelCodename(
  provider: string,
  capability: CustomEndpointCapability,
  modelName?: string | null,
): string {
  const slug = slugifyCodenamePart(provider);
  const modelSlug = modelName ? slugifyCodenamePart(modelName).slice(0, 60) : "";

  return modelSlug ? `${slug}-${capability}-${modelSlug}` : `${slug}-${capability}`;
}

/** Capability segments used in synthetic custom-endpoint codenames. */
const CUSTOM_CODENAME_CAPABILITIES = ["embedding", "image", "video", "text"] as const;

/**
 * Converts a synthetic custom-endpoint model codename into a human-readable
 * display string suitable for stat surfaces (cards, dashboard embeds).
 *
 * Format decoded: `custom-{scope}{id}-{label}-{capability}[-{modelSlug}]`
 *   e.g. `custom-u49-koboldcpp-text-gemma-4-mtp` → `gemma-4-mtp (koboldcpp)`
 *        `custom-s5-home-text`                   → `home`
 *
 * Non-custom codenames are returned unchanged.
 *
 * @param codename - Raw `llm_codename` value from the DB or stat counter key.
 */
export function prettifyModelCodename(codename: string): string {
  if (!codename.startsWith("custom-")) return codename;

  // Strip "custom-" then the scope+id segment (e.g. "u49-" or "s5-").
  const withoutPrefix = codename.slice("custom-".length).replace(/^[us]\d+-/, "");

  for (const cap of CUSTOM_CODENAME_CAPABILITIES) {
    const mid = `-${cap}-`;
    const end = `-${cap}`;

    const midIdx = withoutPrefix.indexOf(mid);
    if (midIdx !== -1) {
      const label = withoutPrefix.slice(0, midIdx);
      const modelSlug = withoutPrefix.slice(midIdx + mid.length);
      return `${modelSlug} (${label})`;
    }

    if (withoutPrefix.endsWith(end)) {
      const label = withoutPrefix.slice(0, -end.length);
      return label || codename;
    }
  }

  return codename;
}

export function formatCustomEndpointModelDisplay(
  endpoint: Pick<CustomEndpointRow, "label" | "model_name" | "display_name">,
): string {
  const label = normalizeCustomEndpointLabel(endpoint.label);
  const primaryName = endpoint.model_name?.trim() || endpoint.display_name.trim();

  if (!primaryName) {
    return `custom-${label}`;
  }

  return primaryName.toLowerCase() === label ? `custom-${label}` : `custom-${label}-${primaryName}`;
}
