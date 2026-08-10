import { seedChatProxyIdentityBio } from "@/utils/chatProxy/bioSeeding";
import { forgetNegativeChatProxyMessageIdentity } from "@/utils/chatProxy/messageIdentityNegativeCache";
import { getProxyServiceDescriptor } from "@/utils/chatProxy/registry";
import type { ProxyMessageAttestation, ProxyServiceDescriptor } from "@/utils/chatProxy/types";
import { chatProxyRepository, type ChatProxyIdentityUpsertResult } from "@/utils/db/repositories/ChatProxyRepository";
import { log } from "@/utils/misc/logger";

export type ChatProxyIdentityPersistenceStatus = "identity_free" | "persisted" | "persistence_failed";

export type ChatProxyIdentityPersistenceDependencies = {
  getDescriptor(serviceId: string): ProxyServiceDescriptor<string> | null;
  persistIdentity(args: {
    input: NonNullable<ProxyMessageAttestation["identity"]>;
    messageDiscId: string;
    senderDiscId: string;
  }): Promise<ChatProxyIdentityUpsertResult | null>;
  seedIdentityBio: typeof seedChatProxyIdentityBio;
};

const DEFAULT_DEPENDENCIES: ChatProxyIdentityPersistenceDependencies = {
  getDescriptor: getProxyServiceDescriptor,
  persistIdentity: (args) => chatProxyRepository.persistAttestedIdentity(args),
  seedIdentityBio: seedChatProxyIdentityBio,
};

export async function persistChatProxyAttestationIdentity(
  args: {
    messageDiscId: string;
    attestation: ProxyMessageAttestation;
    serverDiscId: string | null;
  },
  dependencies: ChatProxyIdentityPersistenceDependencies = DEFAULT_DEPENDENCIES,
): Promise<ChatProxyIdentityPersistenceStatus> {
  const identityInput = args.attestation.identity;
  if (!identityInput) return "identity_free";

  const descriptor = dependencies.getDescriptor(args.attestation.serviceId);
  if (
    descriptor?.capabilities.identity !== "stable" ||
    identityInput.serviceId !== descriptor.serviceId ||
    identityInput.externalIdentityKind !== descriptor.externalIdentityKind ||
    !descriptor.validateExternalKey(identityInput.externalKey)
  ) {
    log.warn(`Rejected invalid chat-proxy identity persistence for message ${args.messageDiscId}`);
    return "persistence_failed";
  }

  const identity = await dependencies.persistIdentity({
    input: identityInput,
    messageDiscId: args.messageDiscId,
    senderDiscId: args.attestation.senderDiscordId,
  });
  if (!identity?.identity.external_identity_id || !identity.namespace.chat_proxy_namespace_id) {
    log.warn(`Chat-proxy identity upsert failed for message ${args.messageDiscId}; continuing without DB identity`);
    return "persistence_failed";
  }

  forgetNegativeChatProxyMessageIdentity(args.messageDiscId);

  if (descriptor.capabilities.identityBio !== "none" && identity.userRow.user_id) {
    void dependencies
      .seedIdentityBio({
        isNewIdentity: identity.isNewIdentity,
        identityUserDiscId: identity.userRow.user_disc_id,
        identityUserId: identity.userRow.user_id,
        description: identityInput.bio,
        serverDiscId: args.serverDiscId,
      })
      .catch((error) => log.warn(`Chat-proxy bio seed failed for ${identity.userRow.user_disc_id}`, error));
  }

  return "persisted";
}
