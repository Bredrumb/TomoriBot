import { isSupporterBillingEnabled } from "@/modules/supporter-billing/config";
import {
  isSupporterEntitlementActive,
  supporterEntitlementRepository,
  supporterIdentityRepository,
  supporterSponsorshipRepository,
} from "@/modules/supporter-billing/db";
import { resolveEnvironment } from "@/types/config";
import type { ProviderOptionCopyContext } from "@/utils/provider/providerOptionRegistry";
import { log } from "@/utils/misc/logger";

interface NudgeDependencies {
  identities: Pick<typeof supporterIdentityRepository, "loadByDiscordUserId">;
  entitlements: Pick<typeof supporterEntitlementRepository, "loadByIdentityId">;
  sponsorships: Pick<typeof supporterSponsorshipRepository, "loadActiveSponsorshipForServer">;
}

export async function resolveSupporterNudgeKey(
  context: ProviderOptionCopyContext,
  dependencies: NudgeDependencies = {
    identities: supporterIdentityRepository,
    entitlements: supporterEntitlementRepository,
    sponsorships: supporterSponsorshipRepository,
  },
): Promise<string | null> {
  if (
    !isSupporterBillingEnabled(resolveEnvironment()) ||
    !context.userDiscId ||
    context.managedProvider ||
    !context.credentialScope
  ) {
    return null;
  }
  try {
    if (context.serverId && (await dependencies.sponsorships.loadActiveSponsorshipForServer(context.serverId))) {
      return null;
    }
    const identity = await dependencies.identities.loadByDiscordUserId(context.userDiscId);
    if (identity) {
      const entitlement = await dependencies.entitlements.loadByIdentityId(identity.supporter_identity_id);
      if (!entitlement || isSupporterEntitlementActive(entitlement)) return null;
    }
    return context.surface === "registration_failed"
      ? "commands.subscribe.conversion_nudge_registration_failed"
      : "commands.subscribe.conversion_nudge";
  } catch {
    log.warn("Subscription conversion eligibility could not be checked", {
      metadata: { credentialScope: context.credentialScope },
    });
    return null;
  }
}
