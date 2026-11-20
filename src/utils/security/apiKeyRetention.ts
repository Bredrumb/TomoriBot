import { createHash } from "node:crypto";
import type { ProviderUsageContext } from "@/utils/provider/providerUsage";
import { currentStoredCredentialActivity, withProviderUsageContext } from "@/utils/provider/providerUsage";
import type { CredentialActivityReference } from "@/utils/db/repositories/ApiKeyRetentionRepository";

export interface StoredCredentialActivity {
  readonly references: readonly CredentialActivityReference[];
  readonly requestKeyDigest: string;
}

export async function storedCredentialUsageContext(ciphertext: Buffer, apiKey: string): Promise<ProviderUsageContext> {
  const { loadCredentialActivityReferences } = await import("@/utils/db/repositories/ApiKeyRetentionRepository");
  return {
    storedCredentialActivity: {
      references: await loadCredentialActivityReferences(ciphertext),
      requestKeyDigest: createHash("sha256").update(apiKey).digest("hex"),
    },
  };
}

export async function withStoredCredentialUsage<T>(
  ciphertext: Buffer,
  apiKey: string,
  execute: () => T,
): Promise<Awaited<T>> {
  return await withProviderUsageContext(await storedCredentialUsageContext(ciphertext, apiKey), execute);
}

export async function recordStoredCredentialRequest(apiKey: string): Promise<void> {
  const activity = currentStoredCredentialActivity();
  if (!activity || activity.requestKeyDigest !== createHash("sha256").update(apiKey).digest("hex")) return;
  const { recordCredentialRequestAttempt } = await import("@/utils/db/repositories/ApiKeyRetentionRepository");
  await recordCredentialRequestAttempt(activity.references);
}

export function readApiKeyInactivityDays(value = process.env.API_KEY_INACTIVITY_DAYS): number | null {
  if (value === undefined) return null;
  const days = Number(value);
  if (
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(days) ||
    !Number.isFinite(new Date(Date.now() + days * 86_400_000).getTime())
  ) {
    throw new Error("API_KEY_INACTIVITY_DAYS must be a positive integer number of days");
  }
  return days;
}
