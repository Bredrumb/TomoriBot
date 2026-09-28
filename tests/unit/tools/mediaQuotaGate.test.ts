import { describe, expect, it } from "bun:test";
import type { QuotaCheckResult } from "@/utils/quota/imageQuotaManager";
import type { ResolvedCredentials } from "@/utils/provider/credentialResolver";
import { resolveCredentialsWithMediaQuota, type CapabilityCredentialResolver } from "@/utils/quota/mediaQuotaGate";

const SERVER_ID = 7;
const USER_DISC_ID = "actor-111111111111111111";
const INTERNAL_USER_ID = 42;

function makeCredentials(source: "server" | "personal"): ResolvedCredentials {
  return {
    provider: source === "server" ? "openrouter" : "custom",
    apiKey: "key",
    keyVersion: 1,
    savedConfig: {} as ResolvedCredentials["savedConfig"],
    source,
  };
}

function resolverReturning(
  source: "server" | "personal",
  calls: Array<{ userId: number | null }>,
): CapabilityCredentialResolver {
  return async (_serverId, _capability, options) => {
    calls.push({ userId: options.userId });
    return makeCredentials(source);
  };
}

describe("media quota gating", () => {
  it("charges the server quota when the server owns the credentials", async () => {
    const resolverCalls: Array<{ userId: number | null }> = [];
    const quotaCalls: Array<{ serverId: number; userDiscId: string }> = [];

    const gate = await resolveCredentialsWithMediaQuota(
      SERVER_ID,
      "image-standard",
      INTERNAL_USER_ID,
      async (serverId, userDiscId): Promise<QuotaCheckResult> => {
        quotaCalls.push({ serverId, userDiscId });
        return { allowed: false, reason: "user_quota_exceeded" };
      },
      USER_DISC_ID,
      { allowed: true },
      resolverReturning("server", resolverCalls),
    );

    expect(resolverCalls).toEqual([{ userId: INTERNAL_USER_ID }]);
    expect(quotaCalls).toEqual([{ serverId: SERVER_ID, userDiscId: USER_DISC_ID }]);
    expect(gate.quotaCheck).toEqual({ allowed: false, reason: "user_quota_exceeded" });
    expect(gate.credentials.source).toBe("server");
  });

  it("bypasses the server quota entirely for a personal BYOK user", async () => {
    const quotaCalls: Array<{ serverId: number; userDiscId: string }> = [];

    const gate = await resolveCredentialsWithMediaQuota(
      SERVER_ID,
      "image-nai",
      INTERNAL_USER_ID,
      async (serverId, userDiscId): Promise<QuotaCheckResult> => {
        quotaCalls.push({ serverId, userDiscId });
        return { allowed: false, reason: "user_quota_exceeded" };
      },
      USER_DISC_ID,
      { allowed: true },
      resolverReturning("personal", []),
    );

    // A BYOK key carries its own provider quota, so the server must not count this run.
    expect(quotaCalls).toEqual([]);
    expect(gate.quotaCheck).toEqual({ allowed: true });
    expect(gate.credentials.source).toBe("personal");
  });

  it("resolves credentials before it decides about a quota check", async () => {
    const order: string[] = [];

    await resolveCredentialsWithMediaQuota(
      SERVER_ID,
      "video",
      null,
      async () => {
        order.push("quota");
        return { allowed: true };
      },
      USER_DISC_ID,
      { allowed: true },
      async () => {
        order.push("credentials");
        return makeCredentials("server");
      },
    );

    // Deciding the source is what makes the quota check conditional, so it has to come first.
    expect(order).toEqual(["credentials", "quota"]);
  });

  it("passes a null user id through for an anonymous caller", async () => {
    const resolverCalls: Array<{ userId: number | null }> = [];

    await resolveCredentialsWithMediaQuota(
      SERVER_ID,
      "video",
      null,
      async () => ({ allowed: true }),
      USER_DISC_ID,
      { allowed: true },
      resolverReturning("personal", resolverCalls),
    );

    expect(resolverCalls).toEqual([{ userId: null }]);
  });
});
