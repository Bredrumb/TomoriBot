import { registerSupporterRequestHook } from "@/modules/supporter-billing/runtime/spendGuard";
import { registerSupporterProviderOption } from "@/modules/supporter-billing/discord/providerOption";

let disposeRegistered: (() => void) | null = null;

// Repeated registration returns the live disposer because duplicate subscription options fail Discord limit checks.
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
