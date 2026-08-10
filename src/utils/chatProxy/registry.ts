import type { Embed, Message } from "discord.js";
import type { ProxyReplyTarget, ProxyServiceDescriptor, ProxyServicePresentation } from "@/utils/chatProxy/types";
import { pluralKitProxyService } from "@/utils/chatProxy/services/pluralkit/descriptor";
import { log } from "@/utils/misc/logger";

export const CHAT_PROXY_DISABLED_SERVICE_ID = "none" as const;
export const CHAT_PROXY_SERVICE_DESCRIPTORS = [pluralKitProxyService] as const;
export type ProxyServiceId = (typeof CHAT_PROXY_SERVICE_DESCRIPTORS)[number]["serviceId"];
export type ChatProxyServiceSelection = typeof CHAT_PROXY_DISABLED_SERVICE_ID | ProxyServiceId;

export type ProxyServiceRegistry<TServiceId extends string = string> = ReadonlyMap<
  TServiceId,
  ProxyServiceDescriptor<TServiceId>
>;

const BIO_CAPABILITIES = new Set(["inline", "separate-fetch", "none"]);

function assertValidCapabilities(descriptor: ProxyServiceDescriptor<string>): void {
  const runtimeDescriptor = descriptor as ProxyServiceDescriptor<string> & {
    attestMessage?: unknown;
    getCachedAttestation?: unknown;
    capabilities: Record<string, unknown>;
  };
  const { capabilities } = runtimeDescriptor;
  const hasAttestation = typeof runtimeDescriptor.attestMessage === "function";
  const hasCachedAttestation = typeof runtimeDescriptor.getCachedAttestation === "function";
  const hasBioCapabilities = "identityBio" in capabilities || "namespaceBio" in capabilities;

  const validNoCorrelation =
    capabilities.correlation === "none" &&
    capabilities.identity === "none" &&
    !hasAttestation &&
    !hasCachedAttestation &&
    !hasBioCapabilities;
  const validIdentityFree =
    capabilities.correlation === "attested" &&
    capabilities.identity === "none" &&
    hasAttestation &&
    !hasBioCapabilities;
  const validStableIdentity =
    capabilities.correlation === "attested" &&
    capabilities.identity === "stable" &&
    hasAttestation &&
    BIO_CAPABILITIES.has(capabilities.identityBio as string) &&
    BIO_CAPABILITIES.has(capabilities.namespaceBio as string);

  if (!validNoCorrelation && !validIdentityFree && !validStableIdentity) {
    throw new Error(`Invalid chat-proxy capability combination for service: ${descriptor.serviceId}`);
  }
}

export function createProxyServiceRegistry<const TDescriptors extends readonly ProxyServiceDescriptor<string>[]>(
  descriptors: TDescriptors,
): ProxyServiceRegistry<TDescriptors[number]["serviceId"]> {
  const byServiceId = new Map<string, ProxyServiceDescriptor<string>>();
  const prefixes = new Set<string>();
  const identityKinds = new Set<string>();
  for (const descriptor of descriptors) {
    assertValidCapabilities(descriptor);
    if (byServiceId.has(descriptor.serviceId)) {
      throw new Error(`Duplicate chat-proxy service ID: ${descriptor.serviceId}`);
    }
    if (prefixes.has(descriptor.syntheticUserPrefix)) {
      throw new Error(`Duplicate chat-proxy synthetic-user prefix: ${descriptor.syntheticUserPrefix}`);
    }
    if (identityKinds.has(descriptor.externalIdentityKind)) {
      throw new Error(`Duplicate chat-proxy external-identity kind: ${descriptor.externalIdentityKind}`);
    }
    byServiceId.set(descriptor.serviceId, descriptor);
    prefixes.add(descriptor.syntheticUserPrefix);
    identityKinds.add(descriptor.externalIdentityKind);
  }
  return byServiceId as ProxyServiceRegistry<TDescriptors[number]["serviceId"]>;
}

export const chatProxyServiceRegistry = createProxyServiceRegistry(CHAT_PROXY_SERVICE_DESCRIPTORS);
const reportedUnknownSelections = new Set<string>();

export function getProxyServiceDescriptor(serviceId: string): ProxyServiceDescriptor<ProxyServiceId> | null {
  return (chatProxyServiceRegistry.get(serviceId as ProxyServiceId) as ProxyServiceDescriptor<ProxyServiceId>) ?? null;
}

export function resolveConfiguredProxyService(serviceId: string | null | undefined): ProxyServiceId | null {
  if (!serviceId || serviceId === CHAT_PROXY_DISABLED_SERVICE_ID) return null;
  const descriptor = getProxyServiceDescriptor(serviceId);
  if (descriptor) return descriptor.serviceId;
  if (!reportedUnknownSelections.has(serviceId)) {
    reportedUnknownSelections.add(serviceId);
    log.warn(`Unknown configured chat-proxy service ignored: ${serviceId}`);
  }
  return null;
}

export function getChatProxyServiceChoices(): readonly ChatProxyServiceSelection[] {
  return [CHAT_PROXY_DISABLED_SERVICE_ID, ...CHAT_PROXY_SERVICE_DESCRIPTORS.map(({ serviceId }) => serviceId)];
}

export function getProxyServicePresentation(serviceId: string): ProxyServicePresentation | null {
  return getProxyServiceDescriptor(serviceId)?.presentation ?? null;
}

export function extractChatProxyReplyTarget(message: Pick<Message, "embeds">): ProxyReplyTarget | null {
  for (const descriptor of CHAT_PROXY_SERVICE_DESCRIPTORS) {
    const target = descriptor.extractReplyTarget?.(message);
    if (target) return target;
  }
  return null;
}

export function extractChatProxyReplyTargetFromEmbed(
  embed: Pick<Embed, "author" | "description">,
): ProxyReplyTarget | null {
  for (const descriptor of CHAT_PROXY_SERVICE_DESCRIPTORS) {
    const target = descriptor.extractReplyTargetFromEmbed?.(embed);
    if (target) return target;
  }
  return null;
}

export function isChatProxyReplyEmbed(embed: Pick<Embed, "author" | "description">): boolean {
  return extractChatProxyReplyTargetFromEmbed(embed) !== null;
}
