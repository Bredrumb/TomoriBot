import type { Embed, Message } from "discord.js";

export type ProxyServiceCapabilities =
  | { correlation: "none"; identity: "none" }
  | { correlation: "attested"; identity: "none" }
  | {
      correlation: "attested";
      identity: "stable";
      identityBio: "inline" | "separate-fetch" | "none";
      namespaceBio: "inline" | "separate-fetch" | "none";
    };

export type ProxyIdentityNamespaceInput = {
  namespaceKey: string;
  shortId: string | null;
  displayName: string | null;
  tag: string | null;
  description: string | null;
};

export type ProxyIdentityUpsertInput = {
  serviceId: string;
  externalIdentityKind: string;
  externalKey: string;
  shortId: string | null;
  displayName: string | null;
  bio: string | null;
  namespace: ProxyIdentityNamespaceInput;
};

export type ProxyMessageAttestation = {
  serviceId: string;
  proxyMessageId: string;
  originalMessageId: string;
  senderDiscordId: string;
  identity: ProxyIdentityUpsertInput | null;
};

export type ProxyReplyTarget = { channelId: string; messageId: string };

export type ChatProxyIdentityContext = {
  serviceId: string;
  userDiscId: string;
  externalIdentityId: number;
  externalKey: string;
  identityShortId: string | null;
  displayName: string | null;
  namespaceId: number;
  namespaceKey: string;
  namespaceShortId: string | null;
  namespaceDisplayName: string | null;
  namespaceTag: string | null;
  namespaceDescription: string | null;
  hostUserDiscIds: string[];
};

export type ChatProxyIndexedMessageIdentity = ChatProxyIdentityContext & {
  messageDiscId: string;
  senderDiscId: string;
};

export type ChatProxyIdentityReference = {
  serviceId: string;
  userDiscId: string;
  displayName: string | null;
  savedNickname: string | null;
};

export type ProxyNamespacePresentation = {
  sectionHeading: string;
  entry: string;
};

export interface ProxyServicePresentation {
  identityMemoryLabel(displayName: string): string;
  identityMembershipLine(context: ChatProxyIdentityContext): string;
  namespacePresentation(
    context: ChatProxyIdentityContext,
    accountLabels: readonly string[],
  ): ProxyNamespacePresentation;
}

type ProxyDescriptorBase<TServiceId extends string> = {
  serviceId: TServiceId;
  settingsLocaleKey: string;
  enabledSuccessDescriptionLocaleKey: string;
  syntheticUserPrefix: `${string}:`;
  externalIdentityKind: string;
  validateExternalKey(externalKey: string): boolean;
  presentation: ProxyServicePresentation;
  canAttestMessage?(message: Message): boolean;
  extractReplyTarget?(message: Pick<Message, "embeds">): ProxyReplyTarget | null;
  extractReplyTargetFromEmbed?(embed: Pick<Embed, "author" | "description">): ProxyReplyTarget | null;
};

export type ProxyServiceDescriptor<TServiceId extends string = string> =
  | (ProxyDescriptorBase<TServiceId> & {
      capabilities: Extract<ProxyServiceCapabilities, { correlation: "none" }>;
      attestMessage?: never;
      getCachedAttestation?: never;
    })
  | (ProxyDescriptorBase<TServiceId> & {
      capabilities: Extract<ProxyServiceCapabilities, { correlation: "attested"; identity: "none" }>;
      attestMessage(proxyMessageId: string): Promise<ProxyMessageAttestation | null>;
      getCachedAttestation?(proxyMessageId: string): ProxyMessageAttestation | null;
    })
  | (ProxyDescriptorBase<TServiceId> & {
      capabilities: Extract<ProxyServiceCapabilities, { correlation: "attested"; identity: "stable" }>;
      attestMessage(proxyMessageId: string): Promise<ProxyMessageAttestation | null>;
      getCachedAttestation?(proxyMessageId: string): ProxyMessageAttestation | null;
    });
