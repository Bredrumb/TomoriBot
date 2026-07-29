/**
 * In-memory cache for NovelAI subscription data (context limit) per guild.
 *
 * Each guild that uses NovelAI may be on a different subscription tier, so the
 * context limit must be fetched per-guild and cached to avoid a subscription
 * API call on every message.
 *
 * Cache lifetime: 24 hours. Entries are refreshed at API key set time and
 * lazily on the first message after a bot restart.
 *
 * ## Why tier → contextLimit (not perks.contextTokens)
 * The subscription API returns perks.contextTokens, but that field does NOT
 * represent the model's context window size — it appears to be an unrelated
 * metric. The context window limit is tier-dependent and must be derived from
 * the tier number using known NAI tier limits.
 */

import { fetchNovelAISubscription } from "@/providers/novelai/novelaiService";
import { log } from "@/utils/misc/logger";

/** TTL for cached subscription entries (24 hours) */
const SUBSCRIPTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Known Kayra context limits per NovelAI subscription tier.
 *
 * Sources:
 * - tier=1 (Tablet): confirmed by API error "Tablet subscription tier's maximum
 *   context size... > 4096 tokens".
 * - tier=2 (Scroll) / tier=3 (Opus): community-verified values from
 *   https://github.com/SillyTavern/SillyTavern/issues/924 and NAI documentation.
 * - tier=0 (Free Trial): smallest observed value, conservative fallback.
 *
 * If NAI ever changes these limits, update this map or add NAI_KAYRA_TIER_X_LIMIT
 * env vars for fine-grained control.
 */
const KAYRA_CONTEXT_LIMIT_BY_TIER: Readonly<Record<number, number>> = {
  0: 1_024, // Free Trial
  1: 4_096, // Tablet
  2: 8_192, // Scroll
  3: 8_192, // Opus (same ceiling for Kayra; Opus perks are Anlas/priority/max_length)
};

interface CachedSubscriptionEntry {
  /** Resolved context token limit for Kayra on this guild's subscription tier */
  contextLimit: number;
  /** The raw tier number from the API, kept for logging/debugging */
  tier: number;
  /** Unix timestamp (ms) when this entry expires */
  expiresAt: number;
}

/** Map from guildId (server Discord ID) to cached subscription entry */
const subscriptionCache = new Map<string, CachedSubscriptionEntry>();

/**
 * Returns the cached Kayra context limit for a guild, or undefined if the
 * cache is cold or expired.
 *
 * @param guildId - Discord guild (server) ID
 */
export function getCachedContextTokens(guildId: string): number | undefined {
  const entry = subscriptionCache.get(guildId);
  if (!entry || Date.now() > entry.expiresAt) {
    return undefined;
  }
  return entry.contextLimit;
}

/**
 * Stores a subscription context limit for a guild in the cache with a 24-hour TTL.
 *
 * @param guildId - Discord guild (server) ID
 * @param contextLimit - Resolved context limit in tokens
 */
export function setCachedContextTokens(guildId: string, contextLimit: number, tier: number): void {
  subscriptionCache.set(guildId, {
    contextLimit,
    tier,
    expiresAt: Date.now() + SUBSCRIPTION_CACHE_TTL_MS,
  });
}

/**
 * Fetches the NovelAI subscription for the given API key, resolves the Kayra
 * context limit from the tier number, caches it under guildId, and returns it.
 *
 * If NAI_KAYRA_CONTEXT_LIMIT is explicitly set in the environment, it takes
 * priority over the API-derived tier lookup — no API call is made. This lets
 * operators who know their exact limit skip the subscription fetch entirely.
 *
 * Returns undefined (without throwing) if the fetch fails — the caller should
 * fall back to the NAI_KAYRA_CONTEXT_LIMIT env var default in that case.
 *
 * @param guildId - Discord guild (server) ID (used as cache key)
 * @param apiKey - Plaintext NovelAI API key
 */
export async function refreshNovelAISubscription(guildId: string, apiKey: string): Promise<number | undefined> {
  // If the operator has explicitly set NAI_KAYRA_CONTEXT_LIMIT, trust it over
  // the tier lookup — skip the subscription API call entirely.
  if (process.env.NAI_KAYRA_CONTEXT_LIMIT !== undefined) {
    const explicitLimit = Number.parseInt(process.env.NAI_KAYRA_CONTEXT_LIMIT, 10);
    if (!Number.isNaN(explicitLimit) && explicitLimit > 0) {
      log.info(
        `NovelAI: NAI_KAYRA_CONTEXT_LIMIT=${explicitLimit} explicitly set — skipping subscription fetch for guild ${guildId}`,
      );
      setCachedContextTokens(guildId, explicitLimit, -1);
      return explicitLimit;
    }
  }

  try {
    const subscription = await fetchNovelAISubscription(apiKey);
    if (!subscription) return undefined;

    const tier = subscription.tier;
    // Resolve the context limit from the tier map; fall back to the highest
    // known limit rather than undefined, so an unrecognized tier isn't punished.
    const contextLimit = KAYRA_CONTEXT_LIMIT_BY_TIER[tier] ?? Math.max(...Object.values(KAYRA_CONTEXT_LIMIT_BY_TIER));

    setCachedContextTokens(guildId, contextLimit, tier);
    log.info(
      `NovelAI subscription fetched for guild ${guildId}: API tier=${tier} → hardcoded limit=${contextLimit} tokens`,
    );
    return contextLimit;
  } catch (error) {
    log.warn(`Failed to refresh NovelAI subscription for guild ${guildId}`, error);
    return undefined;
  }
}

/**
 * Returns the current number of entries held in the NovelAI subscription cache.
 * Used by the cache metrics logger to track in-memory growth over time.
 */
export function getNovelaiSubscriptionCacheSize(): number {
  return subscriptionCache.size;
}

export function clearNovelaiSubscriptionCache(): void {
  subscriptionCache.clear();
}
