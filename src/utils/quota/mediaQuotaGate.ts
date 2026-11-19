import type { Capability, ResolvedCredentials } from "@/utils/provider/credentialResolver";
import { resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import type { GenerationModelSelection } from "@/types/provider/generationModels";

export interface MediaQuotaGateResult<TCheckResult> {
  credentials: ResolvedCredentials;
  quotaCheck: TCheckResult;
}

export type CapabilityCredentialResolver = (
  serverId: number,
  capability: Capability,
  options: { userId: number | null; modelSelection?: GenerationModelSelection },
) => Promise<ResolvedCredentials>;

// Credentials must resolve first and callers must not pre-check quota, because personal BYOK users bring their own
// key and are exempt from server quota.
export async function resolveCredentialsWithMediaQuota<TCheckResult>(
  serverId: number,
  capability: Capability,
  userId: number | null,
  checkQuota: (serverId: number, userDiscId: string) => Promise<TCheckResult>,
  userDiscId: string,
  allowedResult: TCheckResult,
  resolveCredentials: CapabilityCredentialResolver = resolveCapabilityCredentials,
  modelSelection?: GenerationModelSelection,
): Promise<MediaQuotaGateResult<TCheckResult>> {
  const credentials = await resolveCredentials(serverId, capability, {
    userId,
    ...(modelSelection ? { modelSelection } : {}),
  });
  const quotaCheck = credentials.source === "server" ? await checkQuota(serverId, userDiscId) : allowedResult;

  return { credentials, quotaCheck };
}
