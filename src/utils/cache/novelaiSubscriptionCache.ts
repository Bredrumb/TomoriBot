import { createHash } from "node:crypto";
import { fetchNovelAISubscription } from "@/providers/novelai/novelaiService";
import { log } from "@/utils/misc/logger";

const SUBSCRIPTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// These inherited allowances remain provisional until model/tier measurements replace them.
const KAYRA_CONTEXT_LIMIT_BY_TIER: Readonly<Record<number, number>> = {
  0: 1_024,
  1: 4_096,
  2: 8_192,
  3: 8_192,
};

interface CachedSubscriptionEntry {
  tier: number;
  active: boolean;
  expiresAt: number;
}

// Credential identities stay private to this cache and must never enter logs or prompt exports.
const subscriptionCache = new Map<string, CachedSubscriptionEntry>();

function credentialIdentity(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function contextLimitForTier(tier: number): number {
  return KAYRA_CONTEXT_LIMIT_BY_TIER[tier] ?? Math.max(...Object.values(KAYRA_CONTEXT_LIMIT_BY_TIER));
}

export function getCachedContextTokens(apiKey: string): number | undefined {
  const identity = credentialIdentity(apiKey);
  const entry = subscriptionCache.get(identity);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    subscriptionCache.delete(identity);
    return undefined;
  }
  return contextLimitForTier(entry.tier);
}

export function invalidateNovelAISubscription(apiKey: string): void {
  subscriptionCache.delete(credentialIdentity(apiKey));
}

/** Failed lookups leave the cache cold, so callers retain their existing default allowances. */
export async function refreshNovelAISubscription(apiKey: string): Promise<number | undefined> {
  try {
    const subscription = await fetchNovelAISubscription(apiKey);
    if (!subscription) return undefined;
    subscriptionCache.set(credentialIdentity(apiKey), {
      tier: subscription.tier,
      active: subscription.active,
      expiresAt: Date.now() + SUBSCRIPTION_CACHE_TTL_MS,
    });
    return contextLimitForTier(subscription.tier);
  } catch {
    log.warn("Failed to refresh NovelAI subscription; using default token limits.");
    return undefined;
  }
}

export function getNovelaiSubscriptionCacheSize(): number {
  return subscriptionCache.size;
}

export function clearNovelaiSubscriptionCache(): void {
  subscriptionCache.clear();
}
