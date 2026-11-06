import { registerSupporterRequestHook } from "@/modules/supporter-billing/runtime/spendGuard";
import { registerSupporterProviderOption } from "@/modules/supporter-billing/discord/providerOption";

let disposeRegistered: (() => void) | null = null;

/**
 * Registers the spend hold and the Subscription provider option; both read billing state per call, so
 * registration does not depend on whether billing is enabled yet.
 *
 * Repeat calls return the live registration's disposer, because a second Subscription option would
 * repeat its select value and fail every setup panel's Discord limit check.
 */
export function registerSupporterProviderExtensions(): () => void {
  if (disposeRegistered) return disposeRegistered;
  const disposeRequestHook = registerSupporterRequestHook();
  const disposeOption = registerSupporterProviderOption();
  const dispose = () => {
    if (disposeRegistered !== dispose) return;
    disposeRegistered = null;
    disposeOption();
    disposeRequestHook();
  };
  disposeRegistered = dispose;
  return dispose;
}
