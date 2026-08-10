import type { Message } from "discord.js";
import { stripBridgePrefix } from "@/utils/bridges";
import {
  hasNegativeChatProxyMessageIdentity,
  rememberNegativeChatProxyMessageIdentity,
} from "@/utils/chatProxy/messageIdentityNegativeCache";
import { getChatProxyMessageRecord, type ChatProxyMessageRecord } from "@/utils/chatProxy/proxyExpectation";
import { getProxyServiceDescriptor } from "@/utils/chatProxy/registry";
import type { ChatProxyIndexedMessageIdentity, ProxyServiceDescriptor } from "@/utils/chatProxy/types";
import { chatProxyRepository } from "@/utils/db/repositories/ChatProxyRepository";

export type ChatProxyHistoryIdentity = {
  serviceId: string;
  userDiscId: string;
  displayName: string;
  senderDiscId: string;
};

export type ChatProxyHistoryAttributionDependencies = {
  getMessageRecord(messageDiscId: string): ChatProxyMessageRecord | null;
  getDescriptor(serviceId: string): ProxyServiceDescriptor<string> | null;
  loadMessageIdentities(messageDiscIds: string[]): Promise<Map<string, ChatProxyIndexedMessageIdentity> | null>;
};

const DEFAULT_DEPENDENCIES: ChatProxyHistoryAttributionDependencies = {
  getMessageRecord: getChatProxyMessageRecord,
  getDescriptor: getProxyServiceDescriptor,
  loadMessageIdentities: (messageDiscIds) => chatProxyRepository.getMessageIdentitiesByMessageIds(messageDiscIds),
};

export async function resolveChatProxyMessageIdentitiesForHistory(
  messages: Message[],
  dependencies: ChatProxyHistoryAttributionDependencies = DEFAULT_DEPENDENCIES,
): Promise<Map<string, ChatProxyHistoryIdentity>> {
  const identities = new Map<string, ChatProxyHistoryIdentity>();
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const dbLookupIds: string[] = [];
  const seenDbLookupIds = new Set<string>();

  for (const message of messages) {
    if (!message.webhookId) continue;
    if (hasNegativeChatProxyMessageIdentity(message.id)) continue;

    const record = dependencies.getMessageRecord(message.id);
    const descriptor = record ? dependencies.getDescriptor(record.serviceId) : null;
    const cachedAttestation = descriptor?.getCachedAttestation?.(message.id) ?? null;
    const cachedIdentity = cachedAttestation?.identity;
    if (
      record &&
      descriptor &&
      cachedIdentity &&
      cachedAttestation &&
      descriptor.validateExternalKey(cachedIdentity.externalKey)
    ) {
      identities.set(message.id, {
        serviceId: cachedAttestation.serviceId,
        userDiscId: `${descriptor.syntheticUserPrefix}${cachedIdentity.externalKey}`,
        displayName:
          cachedIdentity.displayName ??
          getWebhookDisplayName(message, cachedIdentity.shortId ?? cachedIdentity.externalKey),
        senderDiscId: cachedAttestation.senderDiscordId,
      });
      continue;
    }

    if (!seenDbLookupIds.has(message.id)) {
      seenDbLookupIds.add(message.id);
      dbLookupIds.push(message.id);
    }
  }

  if (dbLookupIds.length === 0) {
    return identities;
  }

  const dbIdentities = await dependencies.loadMessageIdentities(dbLookupIds);
  if (!dbIdentities) {
    return identities;
  }

  for (const messageDiscId of dbLookupIds) {
    if (!dbIdentities.has(messageDiscId)) {
      rememberNegativeChatProxyMessageIdentity(messageDiscId);
    }
  }

  for (const [messageDiscId, identity] of dbIdentities.entries()) {
    const message = messageById.get(messageDiscId);
    identities.set(messageDiscId, {
      serviceId: identity.serviceId,
      userDiscId: identity.userDiscId,
      displayName:
        identity.displayName ?? getWebhookDisplayName(message, identity.identityShortId ?? identity.externalKey),
      senderDiscId: identity.senderDiscId,
    });
  }

  return identities;
}

function getWebhookDisplayName(message: Message | undefined, fallback: string): string {
  const username = message?.author.username ?? "";
  return stripBridgePrefix(username).trim() || username.trim() || fallback;
}
