import { createHash } from "node:crypto";
import { MemberKeyRepository } from "@/modules/supporter-billing/db/repositories/memberKeys";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import {
  createMemberKeyProvider,
  type MemberKeyProvider,
  normalizeMemberKeyLimit,
  MICROS_PER_DOLLAR,
} from "@/modules/supporter-billing/openrouter/management";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import {
  getSupporterFundingFromUsageContext,
  type SupporterFundingContext,
} from "@/modules/supporter-billing/runtime/types";
import { currentProviderUsageContext } from "@/utils/provider/providerUsage";
import { estimateSupporterRequestCost } from "@/modules/supporter-billing/runtime/spendEstimates";
import { type ProviderRequestHold, registerProviderRequestHook } from "@/utils/provider/providerRequestHook";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";

const USAGE_CACHE_MS = 5_000;
// OpenRouter key usage reflected a live speech generation about 18 s after its response, so unreported holds stay in admission for 30 s.
const UNSETTLED_ESTIMATE_TTL_MS = 30_000;

interface UnsettledSpend {
  cost: number;
  releasedAt: number;
}

interface KeySpend {
  baseline: number;
  completed: number;
  usage: number;
  usageReadAt: number;
  unsettled: UnsettledSpend[];
}

function credentialDigest(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

// Pending holds are process-local; use shared admission before running inference in multiple worker processes.
export class SupporterSpendGuard {
  private readonly credentials = new Map<string, { funding: SupporterFundingContext; keyHash: string }>();
  private readonly keys = new Map<string, KeySpend>();
  private readonly pending = new Map<number, number>();
  private readonly admissions = new Map<number, Promise<unknown>>();

  constructor(
    private readonly memberKeys = new MemberKeyRepository(),
    private readonly statistics = supporterUsageStatisticsRepository,
    private readonly provider: () => Pick<MemberKeyProvider, "get"> = createMemberKeyProvider,
  ) {}

  registerCredential(apiKey: string, funding: SupporterFundingContext, keyHash: string): void {
    this.credentials.set(credentialDigest(apiKey), { funding, keyHash });
  }

  confirmedSpend(hash: string): number {
    const state = this.keys.get(hash);
    return state ? Math.max(state.usage, state.baseline + state.completed) : 0;
  }

  observedSpend(hash: string): number {
    const state = this.keys.get(hash);
    if (!state) return 0;
    return state.unsettled.reduce((sum, entry) => sum + entry.cost, this.confirmedSpend(hash));
  }

  pendingSpend(identityId: number): number {
    return this.pending.get(identityId) ?? 0;
  }

  async begin(apiKey: string, estimate: () => Promise<number>): Promise<ProviderRequestHold | undefined> {
    const credential = this.credentials.get(credentialDigest(apiKey));
    if (!credential) return undefined;
    const funding = getSupporterFundingFromUsageContext(currentProviderUsageContext()) ?? credential.funding;
    if (funding.sponsorIdentityId !== credential.funding.sponsorIdentityId) {
      throw this.denied(funding, "billing_unavailable");
    }
    const identityId = funding.sponsorIdentityId;
    const previous = this.admissions.get(identityId) ?? Promise.resolve();
    const admission = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          const row = await this.memberKeys.loadByIdentityId(identityId);
          if (
            !row ||
            row.disabled ||
            row.pending_action ||
            row.key_hash !== credential.keyHash ||
            !row.key_created_at ||
            row.applied_limit === null
          )
            throw this.denied(funding, "billing_unavailable");
          const logged = await this.statistics.totalSince(identityId, row.key_created_at);
          let state = this.keys.get(row.key_hash);
          if (!state) {
            state = { baseline: logged, completed: 0, usage: 0, usageReadAt: 0, unsettled: [] };
            this.keys.set(row.key_hash, state);
          }
          const now = Date.now();
          const hasExpiredUnsettled = state.unsettled.some(
            (entry) => now - entry.releasedAt >= UNSETTLED_ESTIMATE_TTL_MS,
          );
          if (now - state.usageReadAt >= USAGE_CACHE_MS || hasExpiredUnsettled) {
            const remote = await this.provider().get(row.key_hash);
            if (!remote || remote.disabled) throw this.denied(funding, "billing_unavailable");
            state.usage = Math.max(state.usage, remote.usage);
            state.usageReadAt = now;
            state.unsettled = state.unsettled.filter((entry) => now - entry.releasedAt < UNSETTLED_ESTIMATE_TTL_MS);
          }
          // An in-flight request can raise remote usage before reporting its hold, so baseline advances only when idle.
          if (this.pendingSpend(identityId) === 0) {
            state.baseline = Math.max(state.baseline, logged - state.completed, state.usage - state.completed);
          }
          if (Math.max(logged, this.observedSpend(row.key_hash)) + this.pendingSpend(identityId) >= row.applied_limit)
            throw this.denied(funding, "allowance_exhausted");
          let estimated: number;
          try {
            estimated = await estimate();
            if (!Number.isFinite(estimated) || estimated < 0) throw new Error("Invalid request cost estimate");
          } catch (error) {
            const failure = new Error(
              error instanceof Error
                ? error.message.replaceAll(apiKey, "[REDACTED]")
                : "Request cost estimation failed",
            );
            if (error instanceof Error && error.stack) failure.stack = error.stack.replaceAll(apiKey, "[REDACTED]");
            await reportProviderFailure({
              summary: "Subscription request cost estimation failed",
              errorType: "SupporterCostEstimateFailed",
              error: failure,
              expected: false,
              dimensions: {
                provider: "openrouter",
                capability: funding.capability,
                fundingScope: funding.fundingScope,
              },
              metadata: { model: funding.modelCodename, sponsorIdentityId: identityId },
            });
            throw this.denied(funding, "pricing_unavailable");
          }
          const cost = Math.ceil(estimated * MICROS_PER_DOLLAR) / MICROS_PER_DOLLAR;
          const spent = Math.max(logged, this.observedSpend(row.key_hash));
          const pending = this.pendingSpend(identityId);
          if (spent + pending >= row.applied_limit || cost > row.applied_limit - spent - pending)
            throw this.denied(funding, "allowance_exhausted");
          this.pending.set(identityId, normalizeMemberKeyLimit(pending + cost));
          let reported: number | undefined;
          let held = cost;
          let released = false;
          return {
            reportCost: (value: number | null | undefined) => {
              if (released || typeof value !== "number" || !Number.isFinite(value) || value < 0) return;
              state.completed += value - (reported ?? 0);
              const remaining = Math.max(0, normalizeMemberKeyLimit(cost - value));
              this.pending.set(identityId, normalizeMemberKeyLimit(this.pendingSpend(identityId) + remaining - held));
              held = remaining;
              reported = value;
            },
            release: (retainEstimate = false) => {
              if (released) return;
              released = true;
              if (reported === undefined && retainEstimate && cost > 0) {
                state.unsettled.push({ cost, releasedAt: Date.now() });
              }
              const remaining = Math.max(0, normalizeMemberKeyLimit(this.pendingSpend(identityId) - held));
              if (remaining === 0) this.pending.delete(identityId);
              else this.pending.set(identityId, remaining);
            },
          };
        } catch (error) {
          if (error instanceof SupporterRequestDeniedError) throw error;
          throw this.denied(funding, "billing_unavailable");
        }
      });
    this.admissions.set(identityId, admission);
    try {
      return await admission;
    } finally {
      if (this.admissions.get(identityId) === admission) this.admissions.delete(identityId);
    }
  }

  private denied(
    funding: SupporterFundingContext,
    reason: "billing_unavailable" | "pricing_unavailable" | "allowance_exhausted",
  ) {
    return new SupporterRequestDeniedError(
      reason,
      funding.renewalAt ? { periodEnd: funding.renewalAt } : undefined,
      funding.capability,
      funding.fundingScope,
      funding,
    );
  }
}

export const supporterSpendGuard = new SupporterSpendGuard();

async function beginSupporterRequest(apiKey: string, path: string, body: Record<string, unknown>) {
  return supporterSpendGuard.begin(apiKey, () => estimateSupporterRequestCost(path, body));
}

export function registerSupporterRequestHook(): () => void {
  return registerProviderRequestHook(({ apiKey, path, body }) => beginSupporterRequest(apiKey, path, body));
}
