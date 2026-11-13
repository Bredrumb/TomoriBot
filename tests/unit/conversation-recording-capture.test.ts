import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  ChannelType,
  EmbedBuilder,
  type Embed,
  Collection,
  MessageType,
  PermissionFlagsBits,
  type Client,
  type Message,
  type PartialMessage,
} from "discord.js";
import { ConversationRecordingRepository } from "@/modules/conversation-recording/db/repositories";
import type {
  RecordingExcerptInput,
  RecordingIdentity,
  RecordingSession,
} from "@/modules/conversation-recording/db/types";
import { RecordingCaptureRuntime } from "@/modules/conversation-recording/runtime/capture";
import { recordingCaptureRuntime } from "@/modules/conversation-recording/runtime/capture";
import { PrivacyLevel } from "@/types/db/schema";
import type { ContextReferenceCandidate } from "@/utils/db/repositories/UserRepository";
import type { MessageProxyIdentityContext } from "@/utils/messageProxy/types";
import type { MessageProxyHistoryIdentity } from "@/utils/messageProxy/historyAttribution";
import { formatMessageProxyIdentityUserId } from "@/utils/messageProxy/identityUserId";
import captureHandler from "@/events/messageCreate/conversationRecording";
import { log } from "@/utils/misc/logger";
import { createPersona, createUserRow } from "../helpers/fixtures";

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(context: "own" | "surrounding" = "surrounding") {
  const ownerId = "100000000000000001";
  const otherId = "100000000000000002";
  const botId = "100000000000000003";
  const client = { user: { id: botId } } as Client;
  const session: RecordingSession = {
    session_id: "d4909763-d0a8-43a8-84ae-5c79ff4d016a",
    revision: 1,
    context,
    duration: "unlimited",
    started_at: new Date(1000),
    ends_at: null,
    stopped_at: null,
  };
  let active = true;
  let permission = true;
  let lease = true;
  const privateIds = new Set<string>();
  const privacy = new Map<string, PrivacyLevel>();
  const stored: RecordingExcerptInput[] = [];
  const history = new Collection<string, Message>();
  const fetchHistory = mock(async (_options: unknown) => history);
  const members = new Map<
    string,
    { id: string; displayName: string; nickname: null; user: { username: string; globalName: null; bot: boolean } }
  >();
  for (const [id, name] of [
    [ownerId, "Mirri"],
    [otherId, "Bau"],
    [botId, "Tomori"],
  ])
    members.set(id, {
      id,
      displayName: name,
      nickname: null,
      user: { username: name, globalName: null, bot: id === botId },
    });
  const guild = {
    id: "200000000000000001",
    roles: { everyone: {} },
    members: {
      cache: members,
      fetch: mock(async ({ user }: { user: string }) => members.get(user)),
      fetchMe: mock(async () => members.get(botId)),
    },
  };
  const channel = {
    id: "300000000000000001",
    type: ChannelType.GuildText,
    parentId: null as string | null,
    parent: null as unknown,
    guild,
    isDMBased: () => false,
    isThread: () => false,
    permissionOverwrites: { cache: new Collection() },
    permissionsFor: (member: unknown) => ({
      has: (bits: bigint | bigint[]) =>
        member === guild.roles.everyone
          ? true
          : Array.isArray(bits) && bits.includes(PermissionFlagsBits.ReadMessageHistory) && permission,
    }),
    messages: { fetch: fetchHistory },
  };
  const repo = new ConversationRecordingRepository();
  const bind = <K extends keyof ConversationRecordingRepository>(name: K) => {
    const spy = spyOn(repo, name);
    spies.push(spy);
    return spy;
  };
  bind("findCaptureScope").mockImplementation(async () => (active ? { ownerUserId: 1, serverId: 7 } : null));
  bind("getActive").mockImplementation(async () => (active ? { ...session } : null));
  bind("findServerId").mockResolvedValue(7);
  bind("eligibleUsers").mockImplementation(async (_server, ids) => new Set(ids.filter((id) => !privateIds.has(id))));
  const allocated = new Map<string, string>();
  const alias = (identity: RecordingIdentity) => {
    if (identity.kind === "participant" && identity.sourceId === ownerId) return "SELF";
    const key = `${identity.kind}:${identity.sourceId}`;
    if (!allocated.has(key))
      allocated.set(
        key,
        `${identity.kind.toUpperCase()}_${[...allocated.keys()].filter((value) => value.startsWith(`${identity.kind}:`)).length + 1}`,
      );
    return allocated.get(key) ?? "";
  };
  bind("resolveAliases").mockImplementation(async (_scope, _token, identities) => identities.map(alias));
  const append = bind("append").mockImplementation(async (_scope, token, input) => {
    if (!active || token.revision !== session.revision) return { status: "stale" };
    stored.push(input);
    return { status: "stored", excerptId: "fixture", eviction: { excerpts: 0, bytes: 0 } };
  });
  const copies = bind("listSourceCopies").mockImplementation(async () =>
    stored.length
      ? [
          {
            scope: { ownerUserId: 1, serverId: 7 },
            token: { sessionId: session.session_id, revision: session.revision },
            ownerDiscordId: ownerId,
            sourceAuthorId: ownerId,
            privacyUserIds: [ownerId],
          },
        ]
      : [],
  );
  const update = bind("updateSource").mockResolvedValue({ updated: true, eviction: { excerpts: 0, bytes: 0 } });
  const remove = bind("deleteSources").mockImplementation(async () => {
    session.revision++;
    stored.splice(0);
    return 1;
  });
  const candidates = mock(async () => [] as ContextReferenceCandidate[]);
  const proxies = new Map<string, MessageProxyHistoryIdentity>();
  const proxyContext = mock(async (_id: string) => null as MessageProxyIdentityContext | null);
  const runtime = new RecordingCaptureRuntime({
    repository: repo,
    ownership: () => () => lease,
    privacy: async (id) => privacy.get(id) ?? PrivacyLevel.MINIMAL,
    personas: async () => [createPersona({ persona_id: 5, persona_nickname: "Tomori", trigger_words: ["wake up"] })],
    candidates,
    proxyIdentities: async () => proxies,
    proxyContext,
    verifyWebhook: async () => false,
  });
  function message(id: number, authorId = ownerId, content = "Mirri sees Bau"): Message {
    const member = members.get(authorId);
    return {
      id: String(400000000000000000n + BigInt(id)),
      guild,
      guildId: guild.id,
      channel,
      channelId: channel.id,
      author: {
        id: authorId,
        username: member?.user.username ?? "Relay",
        globalName: null,
        bot: member?.user.bot ?? false,
      },
      member,
      inGuild: () => true,
      system: false,
      partial: false,
      type: MessageType.Default,
      content,
      embeds: [],
      webhookId: null,
      createdTimestamp: 10000 + id,
      createdAt: new Date(10000 + id),
      editedAt: null,
      attachments: new Collection(),
      mentions: { users: new Collection() },
      reference: null,
    } as unknown as Message;
  }
  return {
    runtime,
    repo,
    client,
    channel,
    guild,
    ownerId,
    otherId,
    botId,
    session,
    stored,
    history,
    fetchHistory,
    message,
    privacy,
    privateIds,
    copies,
    update,
    remove,
    append,
    candidates,
    proxies,
    proxyContext,
    stop: () => {
      active = false;
      session.revision++;
    },
    change: () => {
      session.revision++;
    },
    deny: () => {
      permission = false;
    },
    loseLease: () => {
      lease = false;
    },
  };
}

describe("recording capture events", () => {
  it("returns from the production event adapter before capture finishes and logs no failure text", async () => {
    const f = fixture();
    const pending = deferred();
    const observe = spyOn(recordingCaptureRuntime, "observeCreate").mockReturnValue(pending.promise);
    const warning = spyOn(log, "warn").mockImplementation(() => {});
    spies.push(observe, warning);
    await captureHandler(f.client, f.message(1));
    expect(observe).toHaveBeenCalledTimes(1);
    pending.resolve();
    observe.mockRejectedValue(new Error("A private transcript must not reach logs"));
    await captureHandler(f.client, f.message(2));
    await Promise.resolve();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private transcript");
  });

  it("performs no history request without consent or for DMs, bots, webhooks, system messages or FULL privacy", async () => {
    for (const kind of ["inactive", "dm", "bot", "webhook", "system", "full"] as const) {
      const f = fixture();
      const message = f.message(1);
      if (kind === "inactive") f.stop();
      if (kind === "dm") Object.assign(message, { inGuild: () => false });
      if (kind === "bot") Object.assign(message.author, { bot: true });
      if (kind === "webhook") Object.assign(message, { webhookId: "500000000000000001" });
      if (kind === "system") Object.assign(message, { system: true });
      if (kind === "full") f.privacy.set(f.ownerId, PrivacyLevel.FULL);
      await f.runtime.observeCreate(f.client, message);
      expect(f.fetchHistory).not.toHaveBeenCalled();
      expect(f.stored).toHaveLength(0);
    }
  });

  it("captures trigger-only windows without needing a bot response and deduplicates concurrent delivery", async () => {
    const f = fixture();
    const trigger = f.message(2, f.ownerId, "");
    Object.assign(trigger, {
      attachments: new Collection([
        ["attachment", { contentType: "image/png", name: "secret.png", url: "https://example.org/secret" }],
      ]),
    });
    await Promise.all([f.runtime.observeCreate(f.client, trigger), f.runtime.observeCreate(f.client, trigger)]);
    await f.runtime.observeCreate(f.client, trigger);
    expect(f.fetchHistory).toHaveBeenCalledTimes(1);
    expect(f.stored[0].messages).toHaveLength(1);
    expect(f.stored[0].messages[0]).toMatchObject({
      body: "",
      speaker: "SELF",
      attachments: { image: 1, video: 0, audio: 0, file: 0 },
    });
    expect(JSON.stringify(f.stored)).not.toMatch(/secret\.png|https:\/\//u);
    await f.runtime.observeDelete(f.guild.id, f.channel.id, [trigger.id]);
    await f.runtime.observeCreate(f.client, trigger);
    expect(f.stored).toHaveLength(0);
    expect(f.fetchHistory).toHaveBeenCalledTimes(1);
  });

  it("bounds pending capture memory and reports saturation without retaining another message", async () => {
    const f = fixture();
    const release = deferred();
    f.fetchHistory.mockImplementation(async () => {
      await release.promise;
      return f.history;
    });
    const pending = Array.from({ length: 64 }, (_, i) => f.runtime.observeCreate(f.client, f.message(i + 1)));
    await expect(f.runtime.observeCreate(f.client, f.message(65))).rejects.toBeInstanceOf(Error);
    release.resolve();
    await Promise.all(pending);
    expect(f.fetchHistory).toHaveBeenCalledTimes(64);
  });

  it("uses one bounded request and preserves consecutive boundaries, ordering and pre-activation context in both modes", async () => {
    for (const context of ["own", "surrounding"] as const) {
      const f = fixture(context);
      f.session.started_at = new Date(10050);
      for (let i = 1; i <= 100; i++) f.history.set(String(i), f.message(i, i % 3 ? f.ownerId : f.otherId));
      const trigger = f.message(101);
      await f.runtime.observeCreate(f.client, trigger);
      expect(f.fetchHistory.mock.calls[0][0]).toEqual({ before: trigger.id, limit: 100, cache: false });
      const messages = f.stored[0].messages;
      expect(messages).toHaveLength(11);
      expect(messages.at(-1)?.sourceMessageId).toBe(trigger.id);
      expect(messages.map((message) => message.timestamp.getTime())).toEqual(
        [...messages.map((message) => message.timestamp.getTime())].sort((a, b) => a - b),
      );
      if (context === "own") expect(messages.every((message) => message.speaker === "SELF")).toBe(true);
      else expect(messages.some((message) => message.speaker !== "SELF")).toBe(true);
      f.history.clear();
      const old = f.message(1);
      f.history.set(old.id, old);
      await f.runtime.observeCreate(f.client, f.message(102));
      expect(f.stored[1].messages[0].timestamp < f.session.started_at).toBe(true);
    }
  });

  it("requires owner and bot access before fetching, including history permission", async () => {
    for (const kind of ["permissions", "owner", "bot", "owner-block"] as const) {
      const f = fixture();
      if (kind === "permissions") f.deny();
      if (kind === "owner" || kind === "bot")
        Object.assign(f.channel, {
          permissionsFor: (member: { id: string }) => ({
            has: () => member.id !== (kind === "owner" ? f.ownerId : f.client.user?.id),
          }),
        });
      if (kind === "owner-block") f.privateIds.add(f.ownerId);
      await f.runtime.observeCreate(f.client, f.message(1));
      expect(f.fetchHistory).not.toHaveBeenCalled();
    }
  });

  it("captures restricted channels and public or private threads when owner and bot have access", async () => {
    for (const type of [ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread]) {
      const f = fixture();
      Object.assign(f.channel, {
        type,
        isThread: () => type !== ChannelType.GuildText,
        parentId: type === ChannelType.GuildText ? null : "300000000000000002",
        permissionsFor: (member: unknown) => ({ has: () => member !== f.channel.guild.roles.everyone }),
      });
      await f.runtime.observeCreate(f.client, f.message(1));
      expect(f.stored).toHaveLength(1);
      expect(f.stored[0].sourceParentChannelId).toBe(f.channel.parentId);
    }
  });

  it("filters privacy exclusions while allowing PARTIAL text, normalizes names and includes eligible replies only", async () => {
    const f = fixture();
    const hidden = f.message(1, f.otherId);
    f.history.set(hidden.id, hidden);
    f.privateIds.add(f.otherId);
    f.privacy.set(f.ownerId, PrivacyLevel.PARTIAL);
    const trigger = f.message(2);
    Object.assign(trigger, { type: MessageType.Reply, reference: { channelId: f.channel.id, messageId: hidden.id } });
    await f.runtime.observeCreate(f.client, trigger);
    expect(f.stored[0].messages).toHaveLength(1);
    expect(f.stored[0].messages[0]).toMatchObject({ body: "[SELF] sees Bau", replyToSourceMessageId: null });
    f.privateIds.clear();
    await f.runtime.observeCreate(f.client, f.message(3));
    expect(f.stored[1].messages[0].speaker).not.toBe("SELF");
    expect(f.stored[1].messages.at(-1)?.body).toMatch(/^\[SELF\] sees \[PARTICIPANT_\d+\]$/u);
  });

  it("reuses bounded candidate nicknames and canonical bot persona identity for names, mentions and speakers", async () => {
    const f = fixture();
    f.candidates.mockResolvedValue([
      {
        userRow: createUserRow({ user_disc_id: f.ownerId, user_nickname: "Mirri Vale" }),
        evidence: { hasServerActivity: true, hasPersonalMemories: false, hasPendingTasks: false },
      },
      {
        userRow: createUserRow({ user_disc_id: f.botId, user_nickname: "Tomori" }),
        evidence: { hasServerActivity: true, hasPersonalMemories: false, hasPendingTasks: false },
      },
    ]);
    const bot = f.message(1, f.botId, "Mirri Vale");
    f.history.set(bot.id, bot);
    const trigger = f.message(2, f.ownerId, `Mirri Vale Tomori <@${f.botId}> wake up`);
    await f.runtime.observeCreate(f.client, trigger);
    const [first, second] = f.stored[0].messages;
    expect(first.body).toBe("[SELF]");
    expect(second.body).toBe(`[SELF] [${first.speaker}] [${first.speaker}] wake up`);
  });

  it("attributes verified proxy surroundings to a distinct identity and applies every linked host's privacy", async () => {
    const f = fixture();
    const proxy = f.message(1, "500000000000000001", "Bau greets Mirri");
    Object.assign(proxy, { webhookId: "500000000000000001" });
    const externalKey = "f20b7fa9-36d1-4c42-97eb-f1afcb0a0f4f";
    const proxyId = formatMessageProxyIdentityUserId("pluralkit", externalKey);
    f.proxies.set(proxy.id, {
      serviceId: "pluralkit",
      userDiscId: proxyId,
      senderDiscId: f.otherId,
      displayName: "Bau",
    });
    f.proxyContext.mockResolvedValue({
      serviceId: "pluralkit",
      instanceId: "pluralkit:official",
      userDiscId: proxyId,
      externalIdentityId: 1,
      externalKey,
      identityShortId: "abcde",
      displayName: "Bau",
      namespaceId: 1,
      namespaceKey: "fghij",
      namespaceShortId: "fghij",
      namespaceDisplayName: null,
      namespaceTag: null,
      namespaceDescription: null,
      hostUserDiscIds: [f.otherId, "100000000000000004"],
    });
    f.history.set(proxy.id, proxy);
    await f.runtime.observeCreate(f.client, f.message(2));
    expect(f.stored[0].messages[0]).toMatchObject({
      sourceAuthorId: proxyId,
      privacyUserIds: [proxyId, f.otherId, "100000000000000004"],
    });
    expect(f.stored[0].messages[0].body).toMatch(/^\[PARTICIPANT_\d+\] greets \[SELF\]$/u);
    f.privateIds.add("100000000000000004");
    await f.runtime.observeCreate(f.client, f.message(3));
    expect(f.stored[1].messages).toHaveLength(1);
  });

  it("retains ordinary webhook messages in surrounding mode with opaque attribution and eligible same-channel replies", async () => {
    const f = fixture();
    const webhook = f.message(1, "500000000000000001", "Relay");
    Object.assign(webhook, { webhookId: "500000000000000001" });
    f.history.set(webhook.id, webhook);
    const trigger = f.message(2);
    Object.assign(trigger, { type: MessageType.Reply, reference: { channelId: f.channel.id, messageId: webhook.id } });
    await f.runtime.observeCreate(f.client, trigger);
    expect(f.stored[0].messages[0].body).toBe(`[${f.stored[0].messages[0].speaker}]`);
    expect(f.stored[0].messages[1].replyToSourceMessageId).toBe(webhook.id);
  });

  it("cannot append after consent, privacy, permissions, lease or deletion changes during retrieval", async () => {
    for (const kind of ["stop", "settings", "permission", "lease", "delete"] as const) {
      const f = fixture();
      const started = deferred();
      const release = deferred();
      f.fetchHistory.mockImplementation(async () => {
        started.resolve();
        await release.promise;
        return f.history;
      });
      const trigger = f.message(1);
      const capture = f.runtime.observeCreate(f.client, trigger);
      await started.promise;
      let deletion: Promise<void> | undefined;
      if (kind === "stop") f.stop();
      if (kind === "settings") f.change();
      if (kind === "permission") f.deny();
      if (kind === "lease") f.loseLease();
      if (kind === "delete") deletion = f.runtime.observeDelete(f.guild.id, f.channel.id, [trigger.id]);
      release.resolve();
      await capture;
      await deletion;
      expect(f.stored).toHaveLength(0);
    }
  });

  it("normalizes complete embed text with message text and replaces it on observed edits", async () => {
    const f = fixture();
    const description = "x".repeat(700);
    const makeEmbed = (text: string) =>
      new EmbedBuilder()
        .setAuthor({ name: "Mirri" })
        .setTitle(`<@${f.otherId}>`)
        .setDescription(text)
        .addFields({ name: `<#${f.channel.id}>`, value: "Bau" })
        .setFooter({ text: `<@${f.ownerId}>` })
        .setImage("https://example.org/private-image.png")
        .toJSON() as unknown as Embed;
    const preceding = f.message(1, f.otherId);
    f.history.set(preceding.id, preceding);
    const source = f.message(2, f.ownerId, "");
    Object.assign(source, { embeds: [makeEmbed(description)] });
    await f.runtime.observeCreate(f.client, source);
    const body = f.stored[0].messages[1].body;
    expect(body).toContain(description);
    expect(body).toContain("[SELF]");
    expect(body).toContain("[CHANNEL_1]");
    expect(body).toMatch(/\[PARTICIPANT_\d+\]/u);
    expect(body).not.toContain(f.ownerId);
    expect(body).not.toContain(f.otherId);
    expect(body).not.toContain("Mirri");
    expect(body).not.toContain("Bau");
    expect(body).not.toContain("https://example.org/private-image.png");
    const replacement = "y".repeat(650);
    const edited = f.message(2, f.ownerId, "");
    Object.assign(edited, { embeds: [makeEmbed(replacement)], editedAt: new Date(20000) });
    await f.runtime.observeUpdate(f.client, edited);
    expect(f.update.mock.calls[0][3].body).toContain(replacement);
    expect(f.update.mock.calls[0][3].body).not.toContain(description);
    expect(f.update.mock.calls[0][3].body).not.toContain(f.otherId);
  });

  it("reconciles edits observed before append and replaces edited attachment metadata", async () => {
    const f = fixture();
    const started = deferred();
    const release = deferred();
    f.fetchHistory.mockImplementation(async () => {
      started.resolve();
      await release.promise;
      return f.history;
    });
    const source = f.message(1);
    const capture = f.runtime.observeCreate(f.client, source);
    await started.promise;
    const edited = f.message(1, f.ownerId, `MIRRI changed [SELF] <#${f.channel.id}> <@&600000000000000001>`);
    Object.assign(edited, {
      editedAt: new Date(20000),
      attachments: new Collection([
        ["a", { contentType: "audio/ogg" }],
        ["b", { contentType: "application/x-unknown" }],
      ]),
    });
    const edit = f.runtime.observeUpdate(f.client, edited);
    release.resolve();
    await Promise.all([capture, edit]);
    expect(f.update).toHaveBeenCalledTimes(1);
    expect(f.update.mock.calls[0][3]).toMatchObject({
      body: "[SELF] changed [SELF] [CHANNEL_1] [ROLE_1]",
      attachments: { image: 0, video: 0, audio: 1, file: 1 },
    });
    expect(f.copies.mock.invocationCallOrder[0]).toBeGreaterThan(f.append.mock.invocationCallOrder[0]);
  });

  it("fetches partial edits only for stored copies with access, and handles bulk deletion in bounded batches", async () => {
    const f = fixture();
    const full = f.message(1, f.ownerId, "MIRRI");
    Object.assign(full, { editedAt: new Date(20000) });
    const fetch = mock(async () => full);
    const partial = { ...full, partial: true, content: null, fetch } as unknown as PartialMessage;
    await f.runtime.observeUpdate(f.client, partial);
    expect(fetch).not.toHaveBeenCalled();
    await f.runtime.observeCreate(f.client, f.message(1));
    await f.runtime.observeUpdate(f.client, partial);
    expect(fetch).toHaveBeenCalledTimes(1);
    f.deny();
    await f.runtime.observeUpdate(f.client, partial);
    expect(fetch).toHaveBeenCalledTimes(1);
    await f.runtime.observeDelete(
      f.guild.id,
      f.channel.id,
      Array.from({ length: 101 }, (_, i) => String(500000000000000000n + BigInt(i))),
    );
    expect(f.remove.mock.calls.map((call) => call[2].length)).toEqual([100, 1]);
  });

  it("refreshes a raced edit revision once and never recreates a deleted source", async () => {
    for (const action of ["revision", "deletion"] as const) {
      const f = fixture();
      await f.runtime.observeCreate(f.client, f.message(1));
      const edited = f.message(1, f.ownerId, "Mirri edits");
      Object.assign(edited, { editedAt: new Date(20000) });
      f.update.mockImplementationOnce(async () => {
        f.change();
        if (action === "deletion") f.stored.splice(0);
        return { updated: false, eviction: { excerpts: 0, bytes: 0 } };
      });
      await f.runtime.observeUpdate(f.client, edited);
      expect(f.update).toHaveBeenCalledTimes(action === "revision" ? 2 : 1);
      expect(f.append).toHaveBeenCalledTimes(1);
      if (action === "deletion") expect(f.stored).toHaveLength(0);
    }
  });
});
