import { getCachedNovelAISubscription, refreshNovelAISubscription } from "@/utils/cache/novelaiSubscriptionCache";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { decryptApiKey } from "@/utils/security/crypto";
import { withStoredCredentialUsage } from "@/utils/security/apiKeyRetention";

export async function getStoredNovelAIModelAccessError(
  model: string,
  ciphertext: Buffer | null,
  keyVersion: number,
): Promise<string | null> {
  if (!ciphertext) return getNovelAIModelAccessError(model, null);
  const apiKey = await decryptApiKey(ciphertext, keyVersion);
  return withStoredCredentialUsage(ciphertext, apiKey, () => getNovelAIModelAccessError(model, apiKey));
}

export async function getNovelAIModelAccessError(
  model: string,
  apiKey: string | null,
  refreshSubscription = false,
): Promise<string | null> {
  if (model !== "xialong-v1" || !apiKey) return null;
  let subscription = refreshSubscription ? undefined : getCachedNovelAISubscription(apiKey);
  if (!subscription) {
    try {
      subscription = await refreshNovelAISubscription(apiKey);
    } catch (error) {
      await reportProviderFailure({
        summary: "NovelAI model selection subscription lookup failed",
        errorType: "ProviderSubscriptionLookup",
        error,
        expected: true,
        detail: error instanceof Error ? error.message : undefined,
        dimensions: { provider: "novelai", operation: "model_selection" },
      });
      return "genai.novelai.subscription_unavailable";
    }
  }
  if (!subscription) return "genai.novelai.subscription_unavailable";
  if (!subscription.active) return "genai.novelai.subscription_inactive";
  return subscription.tier === 3 ? null : "genai.novelai.xialong_opus";
}
