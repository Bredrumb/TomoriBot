import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { stubAllShardOwnership } from "../../helpers/shardOwnership";
import {
  ChannelType,
  Collection,
  EmbedBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  type Client,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import { CrossChannelMessageTool, consumePendingBoomerang } from "@/tools/functionCalls/crossChannelMessageTool";
import { PrivacyLevel } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import * as userCache from "@/utils/cache/userCache";
import * as authorLabels from "@/utils/discord/contextAuthorLabel";
import * as targets from "@/utils/discord/targetResolver";
import * as proxyHistory from "@/utils/messageProxy/historyAttribution";
import * as contextBuilder from "@/utils/text/contextBuilder";
import * as chat from "@/events/messageCreate/tomoriChat";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import * as admissionGuards from "@/utils/chat/admissionGuards";
import * as errorVisibility from "@/utils/chat/errorVisibility";
import * as credentialResolver from "@/utils/provider/credentialResolver";
import * as textModels from "@/utils/provider/textModelSelection";
import { DatabaseUnavailableError } from "@/types/errors";
import { evaluateChatAdmission, normalizeChatInvocation } from "@/utils/chat/admission";
import { planChatTurns } from "@/utils/chat/turnPlanner";
import { runPostTurnEffects } from "@/utils/chat/postTurnEffects";
import type { ChatTurnContext } from "@/utils/chat/types";
import { CreateThreadTool } from "@/tools/functionCalls/createThreadTool";
import * as toolDelivery from "@/utils/discord/webhook/toolPersonaDelivery";
import * as authoredText from "@/utils/discord/modelAuthoredText";
import { createGuildTextChannel } from "../../helpers/discordChannels";
import { ReminderTool } from "@/tools/functionCalls/reminderTool";
import { serverScheduleRepository, userRepository } from "@/utils/db/repositories";

const restores: Array<() => void> = [];
const sourceId = "source-channel";
stubAllShardOwnership();

beforeAll(initializeLocalizer);
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
  consumePendingBoomerang(sourceId);
});

function message(id: string, authorId: string, webhookId: string | null = null): Message {
  return {
    id,
    author: { id: authorId, username: authorId, bot: webhookId !== null || authorId === "bot" },
    webhookId,
    content: id,
    embeds: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
  } as unknown as Message;
}

function fixture(history: Message[], anchorLookup?: () => Promise<Collection<string, Message>>) {
  const fetches: number[] = [];
  const target = {
    ...createGuildTextChannel("target-channel", { guildId: "guild" }),
    id: "target-channel",
    name: "garden",
    isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: mock(async () => message("seed", "bot")),
    messages: {
      fetch: async ({ limit }: { limit: number }) => {
        fetches.push(limit);
        if (limit === 1 && anchorLookup) return anchorLookup();
        const messages = limit === 1 ? [message("anchor", "bot")] : history;
        return new Collection(messages.map((entry) => [entry.id, entry]));
      },
    },
  } as unknown as GuildTextBasedChannel;
  const client = {
    user: { id: "bot" },
    guilds: {
      cache: new Collection(),
      fetch: async () => ({ members: { me: {}, fetch: async (id: string) => ({ id, user: { username: id } }) } }),
    },
  } as unknown as Client;
  const context: ToolContext = {
    channel: createGuildTextChannel(sourceId, { guildId: "guild" }),
    client,
    userId: "invoker",
    guildId: "guild",
    locale: "en-US",
    provider: "google",
    tomoriState: createPersona({ config: { message_fetch_limit: 35 } }),
  };
  const privacy = spyOn(userCache, "getCachedPrivacyLevel").mockImplementation(async (id) =>
    id === "hidden" || id === "hidden-host"
      ? PrivacyLevel.FULL
      : id === "partial"
        ? PrivacyLevel.PARTIAL
        : PrivacyLevel.MINIMAL,
  );
  const proxies = spyOn(proxyHistory, "resolveMessageProxyMessageIdentitiesForHistory").mockImplementation(
    async (messages) =>
      new Map(
        messages
          .filter((entry) => entry.id === "private-proxy")
          .map((entry) => [
            entry.id,
            { serviceId: "pluralkit", userDiscId: "pk:member", senderDiscId: "hidden-host", displayName: "Juno" },
          ]),
      ),
  );
  const labels = spyOn(authorLabels, "resolveContextAuthorLabel").mockImplementation(async (entry) => entry.author.id);
  const mentions = spyOn(contextBuilder, "convertMentions").mockImplementation(async (content) => content);
  const resolve = spyOn(targets, "resolveChannelTarget").mockResolvedValue({
    status: "resolved",
    channel: target,
    displayLabel: "garden",
    source: "legacy_id",
  });
  const dispatch = spyOn(chat, "tomoriChat").mockResolvedValue("run");
  const suppress = spyOn(chat, "suppressNextSelfReply").mockImplementation(() => {});
  for (const spy of [privacy, proxies, labels, mentions, resolve, dispatch, suppress]) {
    restores.push(() => spy.mockRestore());
  }
  return { context, target, privacy, proxies, labels, mentions, dispatch, fetches };
}

describe("cross-channel target authorization", () => {
  it("blocks private targets across tools even with STM sharing allowed, while allowing outward work", async () => {
    const names = spyOn(authoredText, "getKnownPersonaSpeakerNames").mockResolvedValue(new Set());
    const schedule = spyOn(serverScheduleRepository, "addReminder");
    const requester = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(createUserRow());
    restores.push(
      () => names.mockRestore(),
      () => schedule.mockRestore(),
      () => requester.mockRestore(),
    );
    for (const restriction of ["manual", "restricted", "thread", "unknown"]) {
      for (const bypass of [false, true]) {
        const f = fixture([message("private-history", "author")]);
        f.context.tomoriState.config.stm_privacy_bypass = bypass;
        f.context.tomoriState.config.thread_creation_enabled = true;
        if (restriction === "manual") f.context.tomoriState.config.private_channel_ids = [f.target.id];
        if (restriction === "restricted")
          Object.assign(f.target, {
            permissionOverwrites: createGuildTextChannel("target", { viewDenied: true }).permissionOverwrites,
          });
        if (restriction === "thread")
          Object.assign(f.target, {
            type: ChannelType.PublicThread,
            isThread: () => true,
            parent: createGuildTextChannel("restricted-parent", { everyoneCanView: false }),
          });
        if (restriction === "unknown")
          Object.assign(f.target, { type: ChannelType.PublicThread, isThread: () => true, parent: null });
        for (const peek of [false, true]) {
          const result = await new CrossChannelMessageTool().execute(
            { target_channel: "garden", task: "Check", peek_only: peek },
            f.context,
          );
          expect(result.success, `${restriction}, bypass=${bypass}, peek=${peek}`).toBe(false);
        }
        const task = await new ReminderTool().execute(
          {
            target_channel: "garden",
            reminder_purpose: "Check",
            self_reminder: true,
            minutes_from_now: 10,
            repetition_interval_hours: 0,
          },
          f.context,
        );
        expect(task.success).toBe(false);
        expect(task.data).toMatchObject({ status: "reminder_creation_failed_private_target" });
        if (restriction === "manual" || restriction === "restricted") {
          const thread = await new CreateThreadTool().execute(
            { channel_name: "garden", thread_name: "work", first_message: "Check" },
            f.context,
          );
          expect(thread.success).toBe(false);
        }
        expect(f.fetches).toEqual([]);
        expect(f.dispatch).not.toHaveBeenCalled();
      }
    }
    expect(schedule).not.toHaveBeenCalled();
    const outward = fixture([message("public-history", "author")]);
    outward.context.tomoriState.config.private_channel_ids = [sourceId];
    const result = await new CrossChannelMessageTool().execute(
      { target_channel: "garden", task: "Announce", boomerang: false },
      outward.context,
    );
    expect(result.success).toBe(true);
    expect(outward.dispatch).toHaveBeenCalled();
  });

  it("checks the requester rather than a different cached message member", async () => {
    const f = fixture([message("restricted-history", "author")]);
    const anchorAuthor = { id: "privileged-bystander" };
    Object.assign(f.context, { message: { member: anchorAuthor } });
    Object.assign(f.context.client.guilds, {
      fetch: async () => ({ members: { me: { id: "bot" }, fetch: async (id: string) => ({ id }) } }),
    });
    Object.assign(f.target, {
      permissionsFor: (member: { id: string }) =>
        new PermissionsBitField(
          member.id === "invoker" ? [] : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        ),
    });

    const result = await new CrossChannelMessageTool().execute(
      { target_channel: "garden", task: "", peek_only: true },
      f.context,
    );

    expect({ success: result.success, historyReads: f.fetches.length }).toEqual({
      success: false,
      historyReads: 0,
    });
  });

  it("rejects history reads when the requester lacks ReadMessageHistory", async () => {
    const f = fixture([message("restricted-history", "author")]);
    const requester = { id: "invoker" };
    Object.assign(f.context, { message: { member: requester } });
    Object.assign(f.target, {
      permissionsFor: (member: unknown) =>
        new PermissionsBitField(
          member === requester
            ? [PermissionFlagsBits.ViewChannel]
            : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        ),
    });

    const result = await new CrossChannelMessageTool().execute(
      { target_channel: "garden", task: "", peek_only: true },
      f.context,
    );

    expect({ success: result.success, historyReads: f.fetches.length }).toEqual({
      success: false,
      historyReads: 0,
    });
  });

  it("rejects private thread targets before attempting to read history", async () => {
    const f = fixture([message("private-thread-history", "author")]);
    Object.assign(f.target, {
      type: ChannelType.PrivateThread,
      isThread: () => true,
    });

    const result = await new CrossChannelMessageTool().execute(
      { target_channel: "garden", task: "", peek_only: true },
      f.context,
    );

    expect(result.data).toMatchObject({ status: "cross_channel_failed_private_target" });
    expect(f.fetches).toEqual([]);
  });
});

describe("cross-channel request attribution", () => {
  it.each([
    false,
    true,
  ])("allows a thread within the current private channel without borrowing authority (system: %s)", async (borrowed) => {
    const f = fixture([]);
    f.context.channel = f.target;
    f.context.borrowsTriggerMessage = borrowed;
    f.context.message = {
      ...message("anchor", "invoker"),
      member: { id: "invoker", user: { username: "Mirri" } },
    } as Message;
    const permissionChecks: string[] = [];
    Object.assign(f.target, {
      permissionsFor: (member: { id?: string }) => {
        permissionChecks.push(member.id ?? "bot");
        return new PermissionsBitField(PermissionsBitField.All);
      },
    });
    f.context.tomoriState.config.private_channel_ids = [f.target.id];
    f.context.tomoriState.config.thread_creation_enabled = true;
    Object.assign(f.target, {
      threads: {
        create: async () => ({
          id: "created-thread",
          name: "work",
          messages: { fetch: async () => new Collection<string, Message>() },
        }),
      },
    });
    const names = spyOn(authoredText, "getKnownPersonaSpeakerNames").mockResolvedValue(new Set());
    const posted = message("thread-starter", "bot");
    const delivery = spyOn(toolDelivery, "sendToolPersonaPost").mockResolvedValue({
      status: "sent",
      message: posted,
      receipt: {
        messageId: posted.id,
        channelId: "created-thread",
        route: "bot",
        webhookId: null,
        identity: { username: "Juno" },
        speaker: null,
      },
    });
    restores.push(
      () => names.mockRestore(),
      () => delivery.mockRestore(),
    );
    const result = await new CreateThreadTool().execute({ thread_name: "work", first_message: "Check" }, f.context);
    expect(result.success).toBe(true);
    expect(delivery).toHaveBeenCalled();
    expect(consumePendingBoomerang(f.target.id)?.success).toBe(true);
    expect(permissionChecks.includes("invoker")).toBe(!borrowed);
  });

  for (const borrowed of [true, false]) {
    const name = borrowed ? "refuses a borrowed thread request" : "stores human thread attribution";
    it(name, async () => {
      const f = fixture([]);
      f.context.borrowsTriggerMessage = borrowed;
      f.context.tomoriState.config.thread_creation_enabled = true;
      const thread = {
        id: "created-thread",
        name: "garden-chat",
        messages: { fetch: async () => new Collection<string, Message>() },
      };
      const posted = message("thread-starter", "bot");
      Object.assign(f.target, { type: ChannelType.GuildText, threads: { create: async () => thread } });
      Object.assign(f.context.client.guilds, {
        cache: new Collection(),
        fetch: async () => ({
          members: { me: {}, fetch: async (id: string) => ({ id, user: { username: "Mirri" } }) },
        }),
      });
      const names = spyOn(authoredText, "getKnownPersonaSpeakerNames").mockResolvedValue(new Set());
      const delivery = spyOn(toolDelivery, "sendToolPersonaPost").mockResolvedValue({
        status: "sent",
        message: posted,
        receipt: {
          messageId: posted.id,
          channelId: thread.id,
          route: "bot",
          webhookId: null,
          identity: { username: "Mirri" },
          speaker: null,
        },
      });
      for (const spy of [names, delivery]) restores.push(() => spy.mockRestore());

      const result = await new CreateThreadTool().execute(
        { channel_name: "garden", thread_name: thread.name, first_message: "Hello" },
        f.context,
      );

      if (borrowed) {
        expect(result.data).toMatchObject({ status: "create_thread_failed_invoker_not_resolved" });
        expect(delivery).not.toHaveBeenCalled();
        return;
      }
      expect(result.success).toBe(true);
      const pending = consumePendingBoomerang(sourceId);
      expect(pending?.borrowsTriggerMessage).toBe(borrowed);
      expect(pending?.manualTriggerInvoker?.userDiscId).toBe(borrowed ? undefined : f.context.userId);
    });
  }

  for (const borrowed of [true, false]) {
    for (const failedDispatch of [true, false]) {
      const name = borrowed
        ? `refuses a borrowed anchor before ${failedDispatch ? "failing" : "successful"} dispatch`
        : `preserves human attribution through a ${failedDispatch ? "failed" : "successful"} dispatch and report`;
      it(name, async () => {
        const f = fixture([]);
        const persona = f.context.tomoriState;
        const requester = createUserRow({ user_id: 42, user_disc_id: "invoker" });
        const bystander = createUserRow({ user_id: 77, user_disc_id: "source-bystander" });
        const guild = {
          id: "guild",
          members: {
            me: {},
            cache: new Collection(),
            fetch: async (id: string) => ({ id, user: { username: id }, roles: { cache: new Collection() } }),
          },
        };
        const source = Object.assign(f.context.channel, {
          type: ChannelType.PublicThread,
          isThread: () => true,
          guild,
        });
        Object.assign(f.target, {
          type: ChannelType.PublicThread,
          isThread: () => true,
          guild,
          parent: createGuildTextChannel("public-parent", { guildId: "guild" }),
        });
        const sourceAnchor = {
          ...message("source-anchor", bystander.user_disc_id),
          channel: source,
          channelId: sourceId,
          guild,
          client: f.context.client,
          mentions: { users: new Collection(), roles: new Collection(), everyone: false },
          attachments: new Collection(),
          reference: null,
        } as unknown as Message;
        const targetAnchor = {
          ...sourceAnchor,
          ...message("target-anchor", "target-bystander"),
          channel: f.target,
          channelId: f.target.id,
        } as unknown as Message;
        Object.assign(f.target.messages, {
          fetch: async ({ limit }: { limit: number }) =>
            new Collection(limit === 1 ? [[targetAnchor.id, targetAnchor]] : []),
        });
        Object.assign(f.context.client, {
          guilds: { fetch: async () => guild },
          channels: {
            fetch: async () => ({
              isTextBased: () => true,
              messages: { fetch: async () => new Collection([[sourceAnchor.id, sourceAnchor]]) },
            }),
          },
        });
        f.context.userId = borrowed ? bystander.user_disc_id : requester.user_disc_id;
        f.context.borrowsTriggerMessage = borrowed;
        f.context.message = borrowed
          ? ({ ...sourceAnchor, member: { id: bystander.user_disc_id } } as Message)
          : ({ ...sourceAnchor, ...message("request", requester.user_disc_id) } as Message);
        const credentialUsers: Array<number | null | undefined> = [];
        const admissions: string[] = [];
        const invokers: Array<string | undefined> = [];
        const finished = Promise.withResolvers<void>();
        const probes = [
          spyOn(stateCache, "getCachedAllPersonas").mockResolvedValue([persona]),
          spyOn(userCache, "getCachedUserRow").mockImplementation(async (id) =>
            id === requester.user_disc_id ? requester : bystander,
          ),
          spyOn(userCache, "getCachedBlacklistStatus").mockImplementation(
            async (_guild, id) => id !== requester.user_disc_id,
          ),
          spyOn(admissionGuards, "validateDirectChatTrigger").mockResolvedValue({
            shouldContinue: true,
            isReplyToBot: false,
            replyPersona: null,
            isBotMentioned: false,
            isDirectUserIntent: false,
            isUserImpersonation: false,
          }),
          spyOn(admissionGuards, "evaluateChatAccess").mockResolvedValue({
            whitelistStatus: null,
            personalSpotlightStatus: null,
            allowedPersonaIds: null,
            blockedPersonaIds: new Set(),
            rejectedByWhitelist: borrowed,
          }),
          spyOn(errorVisibility, "shouldSurfaceChatUserErrors").mockReturnValue(false),
          spyOn(textModels, "resolveServerTextModel").mockImplementation(async (state) => state.llm),
          spyOn(credentialResolver, "resolvePersonalCapabilityCredentials").mockResolvedValue(null),
          spyOn(credentialResolver, "resolveCapabilityCredentials").mockImplementation(
            async (_serverId, _kind, scope) => {
              credentialUsers.push(scope?.userId);
              throw new DatabaseUnavailableError("stop before generation");
            },
          ),
        ];
        for (const spy of probes) restores.push(() => spy.mockRestore());
        f.dispatch.mockImplementation(async (input) => {
          const isReport = input.message.channelId === sourceId;
          try {
            invokers.push(input.manualTriggerInvoker?.userDiscId);
            const admission = await evaluateChatAdmission(normalizeChatInvocation({ ...input, skipLock: true }));
            admissions.push(admission.disposition);
            if (admission.disposition === "run")
              await planChatTurns({
                admission,
                channelId: input.message.channelId,
                lockedAt: Date.now(),
                queueDepth: 0,
                skipLock: true,
              });
            if (!isReport && failedDispatch) throw new Error("dispatch unavailable");
            return admission.disposition;
          } finally {
            if (isReport) finished.resolve();
          }
        });

        const result = await new CrossChannelMessageTool().execute(
          { target_channel: "garden", task: "Check the conversation", boomerang: true },
          f.context,
        );
        if (borrowed) {
          expect(result.data).toMatchObject({ status: "cross_channel_failed_invoker_not_resolved" });
          expect(f.dispatch).not.toHaveBeenCalled();
          expect(credentialUsers).toEqual([]);
          return;
        }
        const incoming = normalizeChatInvocation({
          client: f.context.client,
          message: f.context.message,
          isFromQueue: false,
          isManuallyTriggered: true,
          borrowsTriggerMessage: borrowed,
        });
        const context = {
          client: f.context.client,
          channel: source,
          message: f.context.message,
          locale: "en-US",
          turn: { lockedTurn: { admission: { incoming } } },
          currentPersona: persona,
          tomoriState: persona,
          shouldSurfaceUserErrors: false,
          shouldApplyTextQuota: false,
          isDMChannel: false,
          isStopResponse: false,
          isUserImpersonation: false,
          reunionPresence: null,
          streamingContext: {},
          contextItems: [],
          simplifiedMessages: [],
        } as unknown as ChatTurnContext;
        await runPostTurnEffects(context, { status: "completed", streamResults: [], personaResponses: [] });
        await finished.promise;

        expect(result.success).toBe(!failedDispatch);
        expect(admissions).toEqual(["run", "run"]);
        expect(invokers).toEqual(borrowed ? [undefined, undefined] : [requester.user_disc_id, requester.user_disc_id]);
        expect(credentialUsers).toEqual(borrowed ? [null, null] : [requester.user_id, requester.user_id]);
        if (borrowed) expect(credentialResolver.resolvePersonalCapabilityCredentials).not.toHaveBeenCalled();
      });
    }
  }
});

describe("cross-channel full privacy", () => {
  it("retains the invoker for a failed dispatch's boomerang", async () => {
    const f = fixture([]);
    f.dispatch.mockRejectedValue(new Error("dispatch unavailable"));

    const result = await new CrossChannelMessageTool().execute(
      { target_channel: "garden", task: "Check the conversation", boomerang: true },
      f.context,
    );

    expect(result.success).toBe(false);
    const pending = consumePendingBoomerang(sourceId);
    expect(pending?.success).toBe(false);
    expect(pending?.manualTriggerInvoker?.userDiscId).toBe(f.context.userId);
  });

  it.each([true, false])("cancels pending target lookup before placeholder or dispatch (empty: %s)", async (empty) => {
    const reached = Promise.withResolvers<void>();
    const lookup = Promise.withResolvers<Collection<string, Message>>();
    const f = fixture([], async () => {
      reached.resolve();
      return lookup.promise;
    });
    const controller = new AbortController();
    f.context.abortSignal = controller.signal;
    const result = new CrossChannelMessageTool()
      .execute({ target_channel: "garden", task: "Check the conversation", boomerang: true }, f.context)
      .then(
        () => null,
        (error: unknown) => error,
      );
    await reached.promise;
    controller.abort();
    lookup.resolve(empty ? new Collection() : new Collection([["anchor", message("anchor", "bot")]]));
    expect(await result).toBeInstanceOf(DOMException);
    expect(f.target.send).not.toHaveBeenCalled();
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(consumePendingBoomerang(sourceId)).toBeUndefined();
  });
  for (const mode of ["peek", "boomerang"] as const) {
    it(`${mode} excludes full-private direct and proxy authors while preserving visible history and refresh boundaries`, async () => {
      const marker = message("refresh", "hidden");
      marker.embeds = [
        new EmbedBuilder().setTitle(localizer("en-US", "commands.refresh.title")).toJSON(),
      ] as Message["embeds"];
      const history = [
        message("newest", "minimal"),
        message("private-proxy", "proxy-webhook", "proxy-webhook"),
        message("private-direct", "hidden"),
        message("partial-message", "partial"),
        message("persona-output", "bot"),
        message("ordinary-webhook", "other-hook", "other-hook"),
        marker,
        message("stale", "minimal"),
      ];
      const fixtureState = fixture(history);
      const result = await new CrossChannelMessageTool().execute(
        {
          target_channel: "garden",
          task: "Check the conversation",
          peek_only: mode === "peek",
          boomerang: mode === "boomerang",
        },
        fixtureState.context,
      );
      expect(result.success).toBe(true);
      const expectedContents = ["ordinary-webhook", "persona-output", "partial-message", "newest"];
      if (mode === "peek") {
        expect(result.data).toMatchObject({
          status: "cross_channel_peek_complete",
          message_count: expectedContents.length,
          messages: expectedContents.map((content) => ({ content })),
        });
        expect(fixtureState.dispatch).not.toHaveBeenCalled();
        expect(fixtureState.fetches).toEqual([35]);
      } else {
        const pending = consumePendingBoomerang(sourceId);
        expect(pending?.manualTriggerInvoker?.userDiscId).toBe(fixtureState.context.userId);
        expect(pending?.targetChannelMessages.map((entry) => entry.content)).toEqual(expectedContents);
        expect(fixtureState.dispatch).toHaveBeenCalledTimes(1);
        expect(fixtureState.fetches).toEqual([1, 10]);
      }
      expect(fixtureState.privacy).toHaveBeenCalledWith("hidden-host");
      expect(fixtureState.privacy).not.toHaveBeenCalledWith("proxy-webhook");
      const formattedIds = fixtureState.labels.mock.calls.map(([entry]) => entry.id);
      expect(formattedIds).toEqual(expectedContents);
      expect(fixtureState.mentions.mock.calls.map(([content]) => content)).toEqual(expectedContents);
      expect(fixtureState.proxies.mock.calls[0]?.[0].map((entry) => entry.id)).not.toContain("stale");
    });

    it(`${mode} returns no history when every author has full privacy`, async () => {
      const fixtureState = fixture([
        message("private-direct", "hidden"),
        message("private-proxy", "proxy-webhook", "proxy-webhook"),
      ]);
      const result = await new CrossChannelMessageTool().execute(
        {
          target_channel: "garden",
          task: "Check the conversation",
          peek_only: mode === "peek",
          boomerang: mode === "boomerang",
        },
        fixtureState.context,
      );
      expect(result.success).toBe(true);
      if (mode === "peek") {
        expect(result.data).toMatchObject({ message_count: 0, messages: [] });
      } else {
        expect(consumePendingBoomerang(sourceId)?.targetChannelMessages).toEqual([]);
      }
      expect(fixtureState.labels).not.toHaveBeenCalled();
      expect(fixtureState.mentions).not.toHaveBeenCalled();
    });
  }
});
