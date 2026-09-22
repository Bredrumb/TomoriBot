import type { Capability, ResolvedCredentials } from "@/utils/provider/credentialResolver";
import { resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";

/**
 * What a generation tool needs before it may run: the credentials it will generate with,
 * and the server quota verdict that only applies to some of them.
 */
export interface MediaQuotaGateResult<TCheckResult> {
  credentials: ResolvedCredentials;
  quotaCheck: TCheckResult;
}

/** The credential source the gate reads. Overridden by tests; production uses the resolver. */
export type CapabilityCredentialResolver = (
  serverId: number,
  capability: Capability,
  options: { userId: number | null },
) => Promise<ResolvedCredentials>;

/**
 * Resolve the capability's credentials, then check server quota only when the server is
 * the one paying.
 *
 * A personal BYOK user brings a key with its own quota, so charging the server's counter
 * for their generation would spend an allowance the server never paid for. Credentials
 * therefore have to resolve first: whether a quota check happens at all depends on which
 * source won.
 *
 * A caller must not add a second quota check earlier: this resolver is what decides the
 * source, and a pre-check would charge server quota to the very users this exempts.
 */
export async function resolveCredentialsWithMediaQuota<TCheckResult>(
  serverId: number,
  capability: Capability,
  userId: number | null,
  checkQuota: (serverId: number, userDiscId: string) => Promise<TCheckResult>,
  userDiscId: string,
  allowedResult: TCheckResult,
  resolveCredentials: CapabilityCredentialResolver = resolveCapabilityCredentials,
): Promise<MediaQuotaGateResult<TCheckResult>> {
  const credentials = await resolveCredentials(serverId, capability, { userId });
  const quotaCheck = credentials.source === "server" ? await checkQuota(serverId, userDiscId) : allowedResult;

  return { credentials, quotaCheck };
}
