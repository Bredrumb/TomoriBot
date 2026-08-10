import type { Message } from "discord.js";
import { chatProxyServiceRegistry, type ProxyServiceRegistry } from "@/utils/chatProxy/registry";
import {
  beginChatProxyLookup,
  findMatchingChatProxyExpectation,
  type ChatProxyExpectation,
} from "@/utils/chatProxy/proxyExpectation";
import type { ProxyMessageAttestation, ProxyServiceDescriptor } from "@/utils/chatProxy/types";
import { log } from "@/utils/misc/logger";

export type ChatProxyRouteStatus =
  | "unsupported_correlation"
  | "unmatched"
  | "timeout_or_error"
  | "conflicting_attestations"
  | "matched_trigger_only"
  | "matched_stable_identity";

export type ChatProxyRouteResult =
  | { status: Exclude<ChatProxyRouteStatus, "matched_trigger_only" | "matched_stable_identity"> }
  | {
      status: "matched_trigger_only" | "matched_stable_identity";
      attestation: ProxyMessageAttestation;
      expectation: ChatProxyExpectation;
    };

const routeMetrics: Record<ChatProxyRouteStatus, number> = {
  unsupported_correlation: 0,
  unmatched: 0,
  timeout_or_error: 0,
  conflicting_attestations: 0,
  matched_trigger_only: 0,
  matched_stable_identity: 0,
};

function routeResult<TResult extends ChatProxyRouteResult>(result: TResult): TResult {
  routeMetrics[result.status] += 1;
  return result;
}

export function getChatProxyRouteMetricsSnapshot(): Readonly<Record<ChatProxyRouteStatus, number>> {
  return { ...routeMetrics };
}

export function clearChatProxyRouteMetricsForTests(): void {
  for (const status of Object.keys(routeMetrics) as ChatProxyRouteStatus[]) {
    routeMetrics[status] = 0;
  }
}

type ChatProxyRouterDependencies = {
  registry: ProxyServiceRegistry<string>;
  findExpectation(channelId: string, attestation: ProxyMessageAttestation): ChatProxyExpectation | null;
};

const DEFAULT_DEPENDENCIES: ChatProxyRouterDependencies = {
  registry: chatProxyServiceRegistry,
  findExpectation: findMatchingChatProxyExpectation,
};

type AttestingProxyServiceDescriptor = Exclude<
  ProxyServiceDescriptor<string>,
  { capabilities: { correlation: "none" } }
>;

function isAttestingDescriptor(
  descriptor: ProxyServiceDescriptor<string> | undefined,
): descriptor is AttestingProxyServiceDescriptor {
  return descriptor?.capabilities.correlation === "attested";
}

export async function routeChatProxyMessage(
  args: {
    message: Message;
    candidateServiceIds: readonly string[];
  },
  dependencyOverrides: Partial<ChatProxyRouterDependencies> = {},
): Promise<ChatProxyRouteResult> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const descriptors = [...new Set(args.candidateServiceIds)]
    .map((serviceId) => dependencies.registry.get(serviceId))
    .filter(isAttestingDescriptor)
    .filter((descriptor) => descriptor.canAttestMessage?.(args.message) ?? true);
  if (descriptors.length === 0) return routeResult({ status: "unsupported_correlation" });

  const endLookup = beginChatProxyLookup(args.message.channelId);
  const settled = await Promise.allSettled(
    descriptors.map(async (descriptor) => descriptor.attestMessage(args.message.id)),
  ).finally(endLookup);
  const errored = settled.some((result) => result.status === "rejected");
  const claims = settled.flatMap((result, index) => {
    if (result.status !== "fulfilled" || !result.value) return [];
    const descriptor = descriptors[index];
    const claim = result.value;
    const invalidIdentity =
      claim.identity !== null &&
      (descriptor.capabilities.identity !== "stable" ||
        claim.identity.serviceId !== descriptor.serviceId ||
        claim.identity.externalIdentityKind !== descriptor.externalIdentityKind ||
        !descriptor.validateExternalKey(claim.identity.externalKey));
    if (claim.serviceId !== descriptor.serviceId || claim.proxyMessageId !== args.message.id || invalidIdentity) {
      log.warn(`Rejected malformed chat-proxy attestation from ${descriptor.serviceId}`);
      return [];
    }
    return [claim];
  });

  if (claims.length > 1) {
    log.error(`Conflicting chat-proxy attestations for message ${args.message.id}`);
    return routeResult({ status: "conflicting_attestations" });
  }
  const attestation = claims[0];
  if (!attestation) return routeResult({ status: errored ? "timeout_or_error" : "unmatched" });

  const expectation = dependencies.findExpectation(args.message.channelId, attestation);
  if (!expectation) return routeResult({ status: "unmatched" });
  return routeResult({
    status: attestation.identity ? "matched_stable_identity" : "matched_trigger_only",
    attestation,
    expectation,
  });
}
