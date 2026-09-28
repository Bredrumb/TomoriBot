import type { Message } from "discord.js";
import { stripBridgePrefix } from "@/utils/bridges";
import {
  hasNegativeMessageProxyMessageIdentity,
  rememberNegativeMessageProxyMessageIdentity,
} from "@/utils/messageProxy/messageIdentityNegativeCache";
import { getMessageProxyMessageRecord, type MessageProxyMessageRecord } from "@/utils/messageProxy/proxyExpectation";
import { getProxyServiceDescriptor } from "@/utils/messageProxy/registry";
import type { MessageProxyIndexedMessageIdentity, ProxyServiceDescriptor } from "@/utils/messageProxy/types";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";

export type MessageProxyHistoryIdentity = {
  serviceId: string;
  userDiscId: string;
  displayName: string;
  senderDiscId: string;
};

export type MessageProxyHistoryAttributionDependencies = {
  getMessageRecord(messageDiscId: string): MessageProxyMessageRecord | null;
  getDescriptor(serviceId: string): ProxyServiceDescriptor<string> | null;
  loadMessageIdentities(messageDiscIds: string[]): Promise<Map<string, MessageProxyIndexedMessageIdentity> | null>;
};

const DEFAULT_DEPENDENCIES: MessageProxyHistoryAttributionDependencies = {
  getMessageRecord: getMessageProxyMessageRecord,
  getDescriptor: getProxyServiceDescriptor,
  loadMessageIdentities: (messageDiscIds) => messageProxyRepository.getMessageIdentitiesByMessageIds(messageDiscIds),
};

export async function resolveMessageProxyMessageIdentitiesForHistory(
  messages: Message[],
  dependencies: MessageProxyHistoryAttributionDependencies = DEFAULT_DEPENDENCIES,
): Promise<Map<string, MessageProxyHistoryIdentity>> {
  const identities = new Map<string, MessageProxyHistoryIdentity>();
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const dbLookupIds: string[] = [];
  const seenDbLookupIds = new Set<string>();

  for (const message of messages) {
    if (!message.webhookId) continue;
    if (hasNegativeMessageProxyMessageIdentity(message.id)) continue;

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
      rememberNegativeMessageProxyMessageIdentity(messageDiscId);
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
