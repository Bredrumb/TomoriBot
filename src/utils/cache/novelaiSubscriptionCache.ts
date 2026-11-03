import { createHash } from "node:crypto";
import { requestNovelAISubscription } from "@/providers/novelai/novelaiService";

const SUBSCRIPTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

export function getCachedNovelAISubscription(apiKey: string): { tier: number; active: boolean } | undefined {
  const identity = credentialIdentity(apiKey);
  const entry = subscriptionCache.get(identity);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    subscriptionCache.delete(identity);
    return undefined;
  }
  return { tier: entry.tier, active: entry.active };
}

export function invalidateNovelAISubscription(apiKey: string): void {
  subscriptionCache.delete(credentialIdentity(apiKey));
}

export async function refreshNovelAISubscription(
  apiKey: string,
): Promise<{ tier: number; active: boolean } | undefined> {
  const subscription = await requestNovelAISubscription(apiKey);
  if (!subscription) return undefined;
  if (subscription.active)
    subscriptionCache.set(credentialIdentity(apiKey), {
      tier: subscription.tier,
      active: subscription.active,
      expiresAt: Date.now() + SUBSCRIPTION_CACHE_TTL_MS,
    });
  else subscriptionCache.delete(credentialIdentity(apiKey));
  return { tier: subscription.tier, active: subscription.active };
}

export function getNovelaiSubscriptionCacheSize(): number {
  return subscriptionCache.size;
}

export function clearNovelaiSubscriptionCache(): void {
  subscriptionCache.clear();
}
