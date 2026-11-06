import type { Client } from "discord.js";
import {
  initializeSupporterBilling,
  isSupporterBillingEnabled,
  registerSupporterProviderExtensions,
} from "@/modules/supporter-billing";
import type { PatreonReconcileJobHandle } from "@/modules/supporter-billing/patreon/reconcile";
import type { AppEnvironment } from "@/types/config";
import { log } from "@/utils/misc/logger";

/**
 * Starts supporter billing and returns its reconcile job for the shutdown path to stop.
 *
 * @throws When the billing config, secrets, or schema are invalid, so startup shutdown releases shard leases.
 */
export async function initSupporterBilling(
  environment: AppEnvironment,
  client?: Client,
): Promise<PatreonReconcileJobHandle | null> {
  registerSupporterProviderExtensions();
  if (!isSupporterBillingEnabled(environment)) {
    return null;
  }

  log.section("Initializing Supporter Billing...");
  const result = await initializeSupporterBilling({ environment, client });
  if (!result.enabled) return null;
  log.success("Supporter billing config validated and billing schema initialized");
  return result.reconcileJob;
}
