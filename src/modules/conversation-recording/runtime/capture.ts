import {
  MessageType,
  PermissionFlagsBits,
  type Client,
  type GuildTextBasedChannel,
  type Message,
  type PartialMessage,
} from "discord.js";
import { PrivacyLevel, type TomoriState } from "@/types/db/schema";
import { conversationRecordingRepository } from "@/modules/conversation-recording/db/repositories";
import type {
  RecordingIdentity,
  RecordingMessageInput,
  RecordingScope,
  RecordingSession,
  RecordingToken,
} from "@/modules/conversation-recording/db/types";
import {
  prepareRecordingBody,
  recordingAttachments,
  recordingIdentityKey,
  recordingParticipantSource,
} from "@/modules/conversation-recording/runtime/identity";
import { getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import {
  getCachedImpersonatedUserIdForWebhook,
  resolvePersonaForMessage,
  verifyMessageWebhook,
} from "@/utils/chat/webhookIdentity";
import { getOwnerWorkSignal, hasShardLeaseOwnership } from "@/utils/cluster/shardLeases";
import { getShardTopology } from "@/utils/discord/shardOwnership";
import { getChannelPrivacyReason } from "@/utils/discord/channelPrivacy";
import { userRepository, isEligibleContextReferenceUserV1 } from "@/utils/db/repositories/UserRepository";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import { resolveMessageProxyMessageIdentitiesForHistory } from "@/utils/messageProxy/historyAttribution";
import { getMessageProxyMessageRecord } from "@/utils/messageProxy/proxyExpectation";
import { getProxyServiceDescriptor } from "@/utils/messageProxy/registry";
import {
  buildDiscordUserAliases,
  buildPersonaAliases,
  buildMessageProxyIdentityAliases,
  buildWebhookAliases,
} from "@/utils/text/participants/aliases";
import {
  createDiscordUserKey,
  createPersonaKey,
  createWebhookKey,
  type ParticipantAlias,
  type ParticipantKey,
} from "@/utils/text/participants/identity";

const HISTORY_REQUEST_LIMIT = 100;
const MAX_PENDING_CAPTURES = 64;
const RECENT_TRIGGER_LIMIT = 10_000;
const REFERENCE_CANDIDATE_LIMIT = 100;

const dependencies = {
  repository: conversationRecordingRepository,
  privacy: getCachedPrivacyLevel,
  personas: getCachedAllPersonas,
  candidates: (guildId: string, ids: string[], text: string) =>
    userRepository.loadContextReferenceCandidates({
      serverDiscId: guildId,
      candidateDiscordIds: ids,
      normalizedHistoryText: text,
      limit: REFERENCE_CANDIDATE_LIMIT,
    }),
  proxyIdentities: (messages: Message[]) =>
    resolveMessageProxyMessageIdentitiesForHistory(messages, {
      getMessageRecord: getMessageProxyMessageRecord,
      getDescriptor: getProxyServiceDescriptor,
      loadMessageIdentities: async (ids) => {
        const identities = await messageProxyRepository.getMessageIdentitiesByMessageIds(ids);
        if (!identities) throw new Error("Recording proxy attribution is unavailable");
        return identities;
      },
    }),
  proxyContext: (id: string) => messageProxyRepository.getIdentityContextByUserDiscId(id),
  verifyWebhook: verifyMessageWebhook,
  ownership: (guildId: string): (() => boolean) => {
    const signal = getOwnerWorkSignal();
    return () => !signal.aborted && hasShardLeaseOwnership() && getShardTopology().ownsServer(guildId, false);
  },
};

type CaptureDependencies = typeof dependencies;
type SourceIdentity = { key: ParticipantKey; privacyIds: string[]; aliases: ParticipantAlias[] };
type Admission = { scope: RecordingScope; session: RecordingSession; token: RecordingToken };

export class RecordingCaptureRuntime {
  private readonly deps: CaptureDependencies;
  private readonly tails = new Map<string, Promise<void>>();
  private readonly pendingCreates = new Set<string>();
  private readonly recentTriggers = new Set<string>();
  private readonly deletions = new Map<string, number>();

  constructor(overrides: Partial<CaptureDependencies> = {}) {
    this.deps = { ...dependencies, ...overrides };
  }

  private enqueue(channelId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(channelId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.tails.set(channelId, next);
    void next
      .finally(() => {
        if (this.tails.get(channelId) === next) this.tails.delete(channelId);
      })
      .catch(() => {});
    return next;
  }

  private async permitted(channel: GuildTextBasedChannel, ownerId: string, serverId: number): Promise<boolean> {
    if (
      getChannelPrivacyReason(channel) !== null ||
      (await this.deps.repository.channelExcluded(serverId, channel.id, channel.isThread() ? channel.parentId : null))
    )
      return false;
    const [owner, bot] = await Promise.all([
      channel.guild.members.fetch({ user: ownerId, force: true }),
      channel.guild.members.fetchMe({ force: true }),
    ]);
    const permissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
    return Boolean(channel.permissionsFor(owner)?.has(permissions) && channel.permissionsFor(bot)?.has(permissions));
  }

  private async admit(message: Message): Promise<Admission | null> {
    if ((await this.deps.privacy(message.author.id)) === PrivacyLevel.FULL) return null;
    const scope = await this.deps.repository.findCaptureScope(message.guildId as string, message.author.id);
    if (!scope) return null;
    const session = await this.deps.repository.getActive(scope);
    if (!session || message.createdAt < session.started_at) return null;
    if (!(await this.deps.repository.eligibleUsers(scope.serverId, [message.author.id])).has(message.author.id))
      return null;
    return { scope, session, token: { sessionId: session.session_id, revision: session.revision } };
  }

  observeCreate(client: Client, message: Message): Promise<void> {
    if (
      !message.inGuild() ||
      message.system ||
      message.author.bot ||
      message.webhookId ||
      !/^\d{1,20}$/u.test(message.id)
    )
      return Promise.resolve();
    const owns = this.deps.ownership(message.guildId);
    if (!owns() || this.recentTriggers.has(message.id)) return Promise.resolve();
    // At 64 pending captures, new windows are skipped; sustained saturation requires measuring memory before raising this limit.
    if (this.pendingCreates.size >= MAX_PENDING_CAPTURES)
      return Promise.reject(new Error("Recording capture capacity reached"));
    this.recentTriggers.add(message.id);
    if (this.recentTriggers.size > RECENT_TRIGGER_LIMIT) {
      const oldest = this.recentTriggers.values().next().value;
      if (oldest) this.recentTriggers.delete(oldest);
    }
    this.pendingCreates.add(message.id);
    const deletion = this.deletions.get(message.guildId) ?? 0;
    const admission = this.admit(message);
    // Consent is read before waiting on channel work, so a queued event keeps its original revision.
    const result = this.enqueue(message.channelId, async () => {
      const admitted = await admission;
      const current = () => owns() && deletion === (this.deletions.get(message.guildId) ?? 0);
      if (!admitted || !current()) return;
      const channel = message.channel;
      if (!(await this.permitted(channel, message.author.id, admitted.scope.serverId)) || !current()) return;
      const history = await channel.messages.fetch({ before: message.id, limit: HISTORY_REQUEST_LIMIT, cache: false });
      if (!current()) return;
      const candidates = [...history.values()].filter(
        (entry) => entry.channelId === message.channelId && BigInt(entry.id) < BigInt(message.id),
      );
      const all = [...candidates, message].filter(
        (entry) => !entry.system && !entry.partial && !getCachedImpersonatedUserIdForWebhook(entry.webhookId),
      );
      const personas = await this.deps.personas(message.guildId);
      const identities = await this.sourceIdentities(client, all, personas, admitted.scope.serverId);
      const eligible = all
        .filter((entry) => {
          const identity = identities.get(entry.id);
          return (
            identity &&
            (admitted.session.context === "surrounding" ||
              recordingParticipantSource(identity.key) === message.author.id)
          );
        })
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      if (eligible.at(-1)?.id !== message.id) return;
      const selected = eligible.slice(-11);
      const catalog = await this.aliasCatalog(selected, identities, personas, admitted.scope.serverId);
      const inputs = await this.normalize(
        selected,
        identities,
        catalog,
        admitted.scope,
        admitted.token,
        client.user?.id,
        personas,
      );
      if (
        !inputs ||
        !current() ||
        !(await this.permitted(channel, message.author.id, admitted.scope.serverId)) ||
        !current()
      )
        return;
      await this.deps.repository.append(admitted.scope, admitted.token, {
        sourceChannelId: channel.id,
        sourceParentChannelId: channel.isThread() ? channel.parentId : null,
        messages: inputs,
      });
    });
    void admission.catch(() => {});
    return result.finally(() => {
      this.pendingCreates.delete(message.id);
    });
  }

  private async sourceIdentities(
    client: Client,
    messages: Message[],
    personas: TomoriState[],
    serverId: number,
  ): Promise<Map<string, SourceIdentity>> {
    const proxies = await this.deps.proxyIdentities(messages);
    const identities = new Map<string, SourceIdentity>();
    for (const message of messages) {
      let identity: SourceIdentity;
      const proxy = proxies.get(message.id);
      if (proxy) {
        const context = await this.deps.proxyContext(proxy.userDiscId);
        if (!context?.hostUserDiscIds.length) continue;
        const privacyIds = [...new Set([proxy.userDiscId, proxy.senderDiscId, ...context.hostUserDiscIds])];
        if (privacyIds.length > 10) continue;
        const key = createDiscordUserKey(proxy.userDiscId);
        identity = {
          key,
          privacyIds,
          aliases: buildMessageProxyIdentityAliases({
            owner: key,
            displayName: proxy.displayName,
            savedNickname: null,
          }),
        };
      } else {
        if (message.webhookId) await this.deps.verifyWebhook(message);
        const persona = resolvePersonaForMessage(message, personas, client.user?.id);
        if (persona?.persona_id !== undefined) {
          const key = createPersonaKey(persona.persona_id);
          identity = {
            key,
            privacyIds: [message.author.id],
            aliases: buildPersonaAliases({ owner: key, nickname: persona.persona_nickname }).aliases.slice(),
          };
        } else if (message.webhookId) {
          const key = createWebhookKey(message.webhookId);
          identity = {
            key,
            privacyIds: [message.author.id],
            aliases: buildWebhookAliases({ owner: key, displayName: message.author.username }),
          };
        } else {
          const key = createDiscordUserKey(message.author.id);
          identity = {
            key,
            privacyIds: [message.author.id],
            aliases: buildDiscordUserAliases({
              owner: key,
              userRow: { user_nickname: null },
              identity: {
                displayName: message.member?.displayName,
                nickname: message.member?.nickname,
                globalName: message.author.globalName,
                username: message.author.username,
              },
              exposeSavedNickname: false,
            }),
          };
        }
      }
      identities.set(message.id, identity);
    }
    const ids = [...new Set([...identities.values()].flatMap((entry) => entry.privacyIds))];
    const allowed = await this.deps.repository.eligibleUsers(serverId, ids);
    const cachedPrivacy = new Map(await Promise.all(ids.map(async (id) => [id, await this.deps.privacy(id)] as const)));
    for (const [id, identity] of identities) {
      if (identity.privacyIds.some((userId) => !allowed.has(userId) || cachedPrivacy.get(userId) === PrivacyLevel.FULL))
        identities.delete(id);
    }
    return identities;
  }

  private async aliasCatalog(
    messages: Message[],
    identities: Map<string, SourceIdentity>,
    personas: TomoriState[],
    serverId: number,
  ): Promise<ParticipantAlias[]> {
    const first = messages[0];
    if (!first?.guild) return [];
    const directIds = new Set(messages.flatMap((message) => [message.author.id, ...message.mentions.users.keys()]));
    const candidates = await this.deps.candidates(
      first.guild.id,
      [...directIds].slice(0, REFERENCE_CANDIDATE_LIMIT),
      messages.map((message) => message.content).join("\n"),
    );
    const allowed = await this.deps.repository.eligibleUsers(
      serverId,
      candidates.map(({ userRow }) => userRow.user_disc_id),
    );
    const aliases = [...identities.values()].flatMap((identity) => identity.aliases);
    for (const { userRow, evidence } of candidates) {
      if (!directIds.has(userRow.user_disc_id) && !isEligibleContextReferenceUserV1(userRow, evidence)) continue;
      if (!allowed.has(userRow.user_disc_id) || (await this.deps.privacy(userRow.user_disc_id)) === PrivacyLevel.FULL)
        continue;
      const member = first.guild.members.cache.get(userRow.user_disc_id);
      if (!member) continue;
      const sourceKey = messages.find((message) => !message.webhookId && message.author.id === member.id);
      const owner = sourceKey ? identities.get(sourceKey.id)?.key : undefined;
      aliases.push(
        ...buildDiscordUserAliases({
          owner: createDiscordUserKey(member.id),
          userRow,
          identity: {
            displayName: member.displayName,
            nickname: member.nickname,
            globalName: member.user.globalName,
            username: member.user.username,
          },
          exposeSavedNickname: false,
        }).map((alias) => ({ ...alias, owner: owner ?? alias.owner })),
      );
    }
    for (const persona of personas) {
      if (persona.persona_id !== undefined)
        aliases.push(
          ...buildPersonaAliases({ owner: createPersonaKey(persona.persona_id), nickname: persona.persona_nickname })
            .aliases,
        );
    }
    return aliases;
  }

  private async normalize(
    messages: Message[],
    sources: Map<string, SourceIdentity>,
    aliases: ParticipantAlias[],
    scope: RecordingScope,
    token: RecordingToken,
    botId: string | undefined,
    personas: TomoriState[],
  ): Promise<RecordingMessageInput[] | null> {
    const main = personas.find((persona) => !persona.is_alter);
    const mentionSources = new Map<string, string>();
    if (botId && main?.persona_id !== undefined)
      mentionSources.set(botId, recordingParticipantSource(createPersonaKey(main.persona_id)));
    const bodies = messages.map((message) => prepareRecordingBody(message.content, aliases, mentionSources));
    const prepared = messages.map((message, index) => {
      const source = sources.get(message.id);
      if (!source) throw new Error("Recording source identity is missing");
      return { message, source, body: bodies[index] };
    });
    const identities: RecordingIdentity[] = prepared.flatMap(({ message, source, body }) => [
      { kind: "participant", sourceId: recordingParticipantSource(source.key) },
      { kind: "channel", sourceId: message.channelId },
      ...body.identities,
    ]);
    const unique = [...new Map(identities.map((identity) => [recordingIdentityKey(identity), identity])).values()];
    const tokens = new Map<string, string>();
    for (let i = 0; i < unique.length; i += 200) {
      const batch = unique.slice(i, i + 200);
      const resolved = await this.deps.repository.resolveAliases(scope, token, batch);
      if (!resolved) return null;
      batch.forEach((identity, index) => {
        tokens.set(recordingIdentityKey(identity), resolved[index]);
      });
    }
    const included = new Set(messages.map((message) => message.id));
    return prepared.map(({ message, source, body }) => {
      const speaker = tokens.get(
        recordingIdentityKey({ kind: "participant", sourceId: recordingParticipantSource(source.key) }),
      );
      const channel = tokens.get(recordingIdentityKey({ kind: "channel", sourceId: message.channelId }));
      if (!speaker || !channel) throw new Error("Recording identity token is missing");
      const replyId =
        message.type === MessageType.Reply &&
        (!message.reference?.channelId || message.reference.channelId === message.channelId)
          ? message.reference?.messageId
          : null;
      return {
        sourceMessageId: message.id,
        sourceAuthorId: recordingParticipantSource(source.key),
        privacyUserIds: source.privacyIds,
        timestamp: message.createdAt,
        editedTimestamp: message.editedAt,
        speaker,
        channel,
        body: body.render(tokens),
        attachments: recordingAttachments(message.attachments.values()),
        replyToSourceMessageId: replyId && included.has(replyId) ? replyId : null,
      };
    });
  }

  observeUpdate(client: Client, message: Message | PartialMessage): Promise<void> {
    if (!message.guildId) return Promise.resolve();
    const owns = this.deps.ownership(message.guildId);
    if (!owns()) return Promise.resolve();
    return this.enqueue(message.channelId, async () => {
      const serverId = await this.deps.repository.findServerId(message.guildId as string);
      if (!serverId || !owns()) return;
      const copies = await this.deps.repository.listSourceCopies(serverId, message.channelId, message.id);
      if (!copies.length) return;
      const personas = await this.deps.personas(message.guildId as string);
      for (const initialCopy of copies) {
        let copy = initialCopy;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (
            !owns() ||
            !(await this.permitted(message.channel as GuildTextBasedChannel, copy.ownerDiscordId, serverId))
          )
            break;
          const full = message.partial ? await message.fetch() : message;
          if (!full.editedAt || full.system) break;
          const identities = await this.sourceIdentities(client, [full], personas, serverId);
          const source = identities.get(full.id);
          const allowed = await this.deps.repository.eligibleUsers(serverId, copy.privacyUserIds);
          if (!source || copy.privacyUserIds.some((id) => !allowed.has(id))) break;
          const key = copy.sourceAuthorId.startsWith("persona:")
            ? createPersonaKey(Number(copy.sourceAuthorId.slice("persona:".length)))
            : copy.sourceAuthorId.startsWith("webhook:")
              ? createWebhookKey(copy.sourceAuthorId.slice("webhook:".length))
              : createDiscordUserKey(copy.sourceAuthorId);
          identities.set(full.id, {
            ...source,
            key,
            aliases: source.aliases.map((alias) => ({ ...alias, owner: key })),
          });
          const aliases = await this.aliasCatalog([full], identities, personas, serverId);
          const normalized = await this.normalize(
            [full],
            identities,
            aliases,
            copy.scope,
            copy.token,
            client.user?.id,
            personas,
          );
          if (!owns()) break;
          if (
            normalized &&
            (
              await this.deps.repository.updateSource(copy.scope, copy.token, full.id, {
                body: normalized[0].body,
                attachments: normalized[0].attachments,
                editedTimestamp: full.editedAt,
              })
            ).updated
          )
            break;
          const refreshed = (await this.deps.repository.listSourceCopies(serverId, message.channelId, message.id)).find(
            (candidate) => candidate.token.sessionId === copy.token.sessionId,
          );
          if (!refreshed || refreshed.token.revision === copy.token.revision) break;
          copy = refreshed;
        }
      }
    });
  }

  async observeDelete(guildId: string | null, channelId: string, messageIds: readonly string[]): Promise<void> {
    if (!guildId || !messageIds.length) return;
    const owns = this.deps.ownership(guildId);
    if (!owns()) return;
    const epoch = (this.deletions.get(guildId) ?? 0) + 1;
    this.deletions.set(guildId, epoch);
    try {
      const serverId = await this.deps.repository.findServerId(guildId);
      if (serverId && owns()) {
        for (let i = 0; i < messageIds.length; i += 100)
          await this.deps.repository.deleteSources(serverId, channelId, messageIds.slice(i, i + 100));
      }
    } finally {
      await Promise.allSettled([...this.tails.values()]);
      if (this.deletions.get(guildId) === epoch) this.deletions.delete(guildId);
    }
  }
}

export const recordingCaptureRuntime = new RecordingCaptureRuntime();
