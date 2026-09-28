import { afterAll, describe, expect, it, mock, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { ChannelType, DMChannel } from "discord.js";
import { PrivacyLevel } from "@/types/db/schema";
import * as audioTranscription from "@/utils/audio/audioAttachmentTranscription";
import { invalidateUserCache } from "@/utils/cache/userCache";
import {
  evaluateChatAdmission,
  resolveAdmissionChannelScope,
  shouldBlockReplyToOtherBot,
} from "@/utils/chat/admission";
import {
  acquireChannelLockForTurn,
  channelLocks,
  getOrCreateChannelLockEntry,
  releaseChannelLockAndReplayQueue,
  setActiveChannelTurnState,
  type QueuedMessage,
} from "@/utils/chat/channelQueue";
import { personaRepository } from "@/utils/db/repositories";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { clearPluralKitApiStateForTests } from "@/utils/messageProxy/services/pluralkit/api";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import {
  clearMessageProxyExpectationStateForTests,
  createMessageProxyExpectation,
  getMessageProxyMessageRecord,
  markMessageProxyExpectationProxied,
  rememberMessageProxyMessage,
} from "@/utils/messageProxy/proxyExpectation";
import {
  clearMessageProxyRouteMetricsForTests,
  getMessageProxyRouteMetricsSnapshot,
} from "@/utils/messageProxy/router";
import type { ChatIncoming } from "@/utils/chat/types";
import { stallUntilAborted, stubGlobalFetch } from "../../helpers/fetchStub";
import { createUserRow } from "../../helpers/fixtures";

const originalFetch = globalThis.fetch;
const originalLookupTimeoutMs = process.env.PLURALKIT_LOOKUP_TIMEOUT_MS;

// Both mutations are process-wide, and Bun does not reset them between the files
// sharing this lane, so the restore has to live in a hook.
afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalLookupTimeoutMs === undefined) delete process.env.PLURALKIT_LOOKUP_TIMEOUT_MS;
  else process.env.PLURALKIT_LOOKUP_TIMEOUT_MS = originalLookupTimeoutMs;
});

// Object.create skips the discord.js constructor (which demands a live client and a full
// API payload) while still satisfying the `instanceof DMChannel` branch under test.
function makeDmIncoming(args: { authorDiscId: string; recipientDiscId: string }): ChatIncoming {
  const channel = Object.assign(Object.create(DMChannel.prototype), {
    id: "dm-channel",
    type: 1,
    recipientId: args.recipientDiscId,
  });

  return {
    client: { user: { id: "tomori-bot" } },
    message: { channel, guild: null, author: { id: args.authorDiscId } },
    isManuallyTriggered: true,
  } as unknown as ChatIncoming;
}

function makeReplyIncoming(cachedReference: Message, fetchedReference: Message) {
  const fetch = mock(async () => fetchedReference);
  const incoming = {
    client: {
      user: { id: "tomori" },
    },
    message: {
      content: "ordinary reply",
      reference: { messageId: "referenced-message" },
      channel: {
        messages: {
          cache: {
            get: () => cachedReference,
          },
          fetch,
        },
      },
      mentions: {
        users: {
          has: () => false,
        },
      },
    },
    isManuallyTriggered: false,
  } as unknown as ChatIncoming;

  return { fetch, incoming };
}

describe("shouldBlockReplyToOtherBot", () => {
  it("hydrates an authorless partial reply target before checking its author", async () => {
    const partialReference = {
      partial: true,
      author: null,
    } as unknown as Message;
    const fetchedReference = {
      partial: false,
      author: { id: "another-bot", bot: true },
      webhookId: null,
    } as Message;
    const { fetch, incoming } = makeReplyIncoming(partialReference, fetchedReference);

    const reason = await shouldBlockReplyToOtherBot({
      incoming,
      earlyAllPersonas: [],
      isBotAuthor: false,
    });

    expect(fetch).toHaveBeenCalledWith("referenced-message");
    expect(reason).toBe("reply_to_other_bot");
  });

  it("allows an unresolved authorless reply target without throwing", async () => {
    const authorlessReference = {
      partial: true,
      author: null,
      webhookId: null,
    } as unknown as Message;
    const { incoming } = makeReplyIncoming(authorlessReference, authorlessReference);

    const reason = await shouldBlockReplyToOtherBot({
      incoming,
      earlyAllPersonas: [],
      isBotAuthor: false,
    });

    expect(reason).toBeNull();
  });

  it("does not treat a base trigger word wrapped in a diacritic-adjacent word as direct address", async () => {
    // Boundary semantics live in tests/unit/text/regexUtils.test.ts; this pins that a
    // base trigger word buried in an unrelated word does not read as being addressed.
    const wordContainingTrigger = "prätomo";
    const otherBotReference = {
      partial: false,
      author: { id: "another-bot", bot: true },
      webhookId: null,
    } as Message;
    const { incoming } = makeReplyIncoming(otherBotReference, otherBotReference);
    incoming.message.content = `this message only contains the unrelated word ${wordContainingTrigger}`;

    const reason = await shouldBlockReplyToOtherBot({
      incoming,
      earlyAllPersonas: [],
      isBotAuthor: false,
    });

    expect(reason).toBe("reply_to_other_bot");
  });
});

describe("resolveAdmissionChannelScope DM server key", () => {
  it("keys a DM to its recipient even when the trigger message was authored by the bot", async () => {
    // Reminder and boomerang turns pass the channel's last message as their trigger, so a
    // bot-authored trigger must not resolve the DM to the bot's own (unconfigured) id.
    const incoming = makeDmIncoming({ authorDiscId: "tomori-bot", recipientDiscId: "human-user" });

    const scope = await resolveAdmissionChannelScope(incoming, "tomori-bot");

    expect(scope?.serverDiscId).toBe("human-user");
    expect(scope?.isDMChannel).toBe(true);
  });

  it("keys a DM to its recipient for ordinary user-authored messages", async () => {
    const incoming = makeDmIncoming({ authorDiscId: "human-user", recipientDiscId: "human-user" });

    const scope = await resolveAdmissionChannelScope(incoming, "human-user");

    expect(scope?.serverDiscId).toBe("human-user");
  });

  it("falls back to the resolved user when the channel has no recipient id", async () => {
    const incoming = makeDmIncoming({ authorDiscId: "human-user", recipientDiscId: "human-user" });
    (incoming.message.channel as unknown as { recipientId: string | null }).recipientId = null;

    const scope = await resolveAdmissionChannelScope(incoming, "human-user");

    expect(scope?.serverDiscId).toBe("human-user");
  });

  it("prefers an explicit system-trigger identity when cached DM metadata is wrong", async () => {
    const incoming = makeDmIncoming({ authorDiscId: "tomori-bot", recipientDiscId: "tomori-bot" });
    incoming.systemTriggerIdentity = {
      serverDiscId: "human-user",
      userDiscId: "human-user",
    };

    const scope = await resolveAdmissionChannelScope(incoming, incoming.systemTriggerIdentity.userDiscId);

    expect(scope?.serverDiscId).toBe("human-user");
  });
});

describe("evaluateChatAdmission server blacklist", () => {
  it("blocks a blacklisted member before audio transcription can run", async () => {
    const memberId = "100000000000000021";
    invalidateUserCache(memberId);
    const rowSpy = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(null);
    const privacySpy = spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklistSpy = spyOn(userRepository, "isBlacklisted").mockResolvedValue(true);
    const transcribeSpy = spyOn(audioTranscription, "transcribeMessageAudioAttachment");

    try {
      const incoming = {
        client: { user: { id: "tomori" } },
        message: {
          id: "voice-message",
          content: "",
          webhookId: null,
          interaction: null,
          reference: null,
          author: { id: memberId, bot: false, username: "member" },
          guild: { id: "300000000000000031" },
          channel: { id: "thread-1", type: ChannelType.PublicThread },
        },
        isManuallyTriggered: false,
      } as unknown as ChatIncoming;

      const admission = await evaluateChatAdmission(incoming);

      expect(admission.disposition).toBe("blocked");
      expect(admission.disposition === "run" ? null : admission.reason).toBe("server_blacklisted_user");
      expect(blacklistSpy).toHaveBeenCalledWith("300000000000000031", memberId);
      expect(transcribeSpy).not.toHaveBeenCalled();
    } finally {
      for (const spy of [rowSpy, privacySpy, blacklistSpy, transcribeSpy]) spy.mockRestore();
      invalidateUserCache(memberId);
    }
  });
});

describe("evaluateChatAdmission message-proxy lookup failure", () => {
  it("keeps an unverifiable webhook on the ordinary path without creating a proxy identity", async () => {
    const guildId = "300000000000000041";
    const channelId = "proxy-thread-1";
    const originalMessageId = "original-message-1";
    const webhookMessageId = "webhook-message-1";
    const webhookAuthorId = "999000000000000001";
    process.env.PLURALKIT_LOOKUP_TIMEOUT_MS = "600";

    // A live expectation for this channel is what makes admission attempt a lookup.
    createMessageProxyExpectation({
      serviceId: "pluralkit",
      channelId,
      originalMessageId,
      senderDiscId: "100000000000000041",
      originalMessage: { id: originalMessageId } as Message,
      originalReference: null,
    });

    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => stallUntilAborted(init?.signal));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // The blacklist stops admission right after the lookup stage. That the check runs at
    // all against the webhook's own author is the point: a fabricated host identity would
    // have re-keyed authorization to the host account instead.
    const personasSpy = spyOn(personaRepository, "loadAllForServer").mockResolvedValue([]);
    const privacySpy = spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklistSpy = spyOn(userRepository, "isBlacklisted").mockResolvedValue(true);
    clearMessageProxyRouteMetricsForTests();

    try {
      const incoming = {
        client: { user: { id: "tomori" } },
        message: {
          id: webhookMessageId,
          channelId,
          guildId,
          content: "hello there",
          webhookId: "webhook-1",
          interaction: null,
          reference: null,
          client: { user: { id: "tomori" } },
          author: { id: webhookAuthorId, bot: true, username: "Mirri" },
          guild: { id: guildId, members: { cache: { get: () => null } } },
          channel: { id: channelId, type: ChannelType.PublicThread },
        },
        isManuallyTriggered: false,
      } as unknown as ChatIncoming;

      const admission = await evaluateChatAdmission(incoming);

      // The stalled lookup could not attest the repost, so this stays an ordinary
      // webhook: the transport failure is counted truthfully, no identity or proxy
      // record is written, and the message cannot claim a trigger.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getMessageProxyRouteMetricsSnapshot()).toMatchObject({ timeout_or_error: 1, unmatched: 0 });
      expect(getMessageProxyMessageRecord(webhookMessageId)).toBeNull();
      expect(blacklistSpy).toHaveBeenCalledWith(guildId, webhookAuthorId);
      expect(admission.disposition === "run" ? null : admission.reason).toBe("server_blacklisted_user");
    } finally {
      for (const spy of [personasSpy, privacySpy, blacklistSpy]) spy.mockRestore();
      clearMessageProxyExpectationStateForTests();
      clearMessageProxyRouteMetricsForTests();
    }
  });
});

describe("evaluateChatAdmission verified proxy follow-ups", () => {
  const channelId = "proxy-follow-up-thread";

  /**
   * Stubs every read between a PluralKit repost and the queue gate. The host selected PluralKit, and
   * the identity write succeeds without a local user ID so no bio seed reaches the database.
   */
  function stubVerifiedPluralKitRepost(args: {
    hostDiscId: string;
    originalMessageId: string;
    beforeAnswer?: () => Promise<void>;
  }) {
    const fetchSpy = stubGlobalFetch(async () => {
      await args.beforeAnswer?.();
      return Response.json({
        original: args.originalMessageId,
        sender: args.hostDiscId,
        system: { id: "abcdef", uuid: "11111111-2222-4333-8444-555555555555", name: "Lighthouse" },
        member: { id: "ghijkl", uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "Mirri" },
      });
    });
    const spies = [
      spyOn(personaRepository, "loadAllForServer").mockResolvedValue([]),
      spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL),
      spyOn(userRepository, "isBlacklisted").mockResolvedValue(false),
      spyOn(userRepository, "loadByDiscordId").mockResolvedValue(
        createUserRow({ user_disc_id: args.hostDiscId, message_proxy_service: "pluralkit" }),
      ),
      spyOn(messageProxyRepository, "persistAttestedIdentity").mockResolvedValue({
        userRow: createUserRow({ user_id: undefined, user_disc_id: "pk:ghijkl", user_nickname: "Mirri" }),
        namespace: { message_proxy_namespace_id: 51, service_id: "pluralkit", namespace_key: "abcdef" },
        identity: { message_proxy_identity_id: 61, message_proxy_namespace_id: 51, external_identity_id: 71 },
        isNewIdentity: false,
      }),
    ];
    return {
      fetchSpy,
      restore: () => {
        for (const spy of [fetchSpy, ...spies]) spy.mockRestore();
        invalidateUserCache(args.hostDiscId);
        channelLocks.clear();
        StreamOrchestrator.clearStopRequest(channelId);
        clearMessageProxyExpectationStateForTests();
        clearPluralKitApiStateForTests();
      },
    };
  }

  /** The host's original is still held by its speedbump, as it is while PluralKit reposts it. */
  function holdOriginal(hostDiscId: string, originalMessageId: string) {
    return createMessageProxyExpectation({
      serviceId: "pluralkit",
      channelId,
      originalMessageId,
      senderDiscId: hostDiscId,
      originalMessage: { id: originalMessageId, author: { id: hostDiscId, bot: false } } as Message,
      originalReference: null,
    });
  }

  function makeRepostIncoming(guildId: string, repostMessageId: string, overrides: Partial<ChatIncoming> = {}) {
    return {
      client: { user: { id: "tomori" } },
      message: {
        id: repostMessageId,
        channelId,
        guildId,
        content: "and one more thing",
        webhookId: "pk-webhook",
        interaction: null,
        reference: null,
        components: [],
        mentions: { users: { has: () => false }, roles: { size: 0 } },
        client: { user: { id: "tomori" } },
        author: { id: "999000000000000061", bot: true, username: "Mirri", avatar: null },
        guild: { id: guildId, members: { cache: { get: () => null } } },
        channel: { id: channelId, type: ChannelType.PublicThread, messages: { cache: new Map() } },
      },
      isFromQueue: false,
      isManuallyTriggered: false,
      ...overrides,
    } as unknown as ChatIncoming;
  }

  function lockHostTurn(hostDiscId: string, activeMessageId = "active-host-turn") {
    const lockEntry = getOrCreateChannelLockEntry(channelId, "unused");
    acquireChannelLockForTurn(lockEntry, {
      messageId: activeMessageId,
      userDiscId: hostDiscId,
      isPersonaJob: false,
      isCommandTriggered: false,
    });
    setActiveChannelTurnState(lockEntry, { followUpEligible: true });
    return lockEntry;
  }

  it("interrupts a verified repost from the same member and replays it as the host", async () => {
    const guildId = "300000000000000061";
    const hostDiscId = "100000000000000061";
    const stubs = stubVerifiedPluralKitRepost({ hostDiscId, originalMessageId: "original-follow-up-1" });
    try {
      holdOriginal(hostDiscId, "original-follow-up-1");
      const activeExpectation = holdOriginal(hostDiscId, "original-active-member");
      markMessageProxyExpectationProxied(activeExpectation);
      rememberMessageProxyMessage({
        messageDiscId: "active-member-turn",
        channelId,
        expectation: activeExpectation,
        identityUserDiscId: "pk:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      });
      const lockEntry = lockHostTurn(hostDiscId, "active-member-turn");

      const admission = await evaluateChatAdmission(makeRepostIncoming(guildId, "repost-follow-up-1"));

      expect(admission.disposition === "run" ? null : admission.reason).toBe("locked_follow_up_queued");
      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(true);

      const replayed: QueuedMessage[] = [];
      releaseChannelLockAndReplayQueue({
        channelId,
        lockEntry,
        completedMessageId: "active-host-turn",
        handleStopResponse: async () => {},
        processQueuedMessage: async (queued) => {
          replayed.push(queued);
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const [followUp] = replayed;
      if (!followUp) throw new Error("The verified repost was not replayed");

      const lookupsBeforeReplay = stubs.fetchSpy.mock.calls.length;
      const replay = await evaluateChatAdmission(
        makeRepostIncoming(guildId, followUp.message.id, {
          isFromQueue: true,
          isManuallyTriggered: followUp.isManuallyTriggered,
          textQuotaUserDiscId: followUp.textQuotaUserDiscId,
        }),
      );

      // The replayed turn answers as the host account from the confirmed record, without a
      // second PluralKit lookup that could fail and strip the member's identity.
      expect(replay.disposition === "run" ? replay.userDiscId : replay.reason).toBe(hostDiscId);
      expect(stubs.fetchSpy.mock.calls.length).toBe(lookupsBeforeReplay);
    } finally {
      stubs.restore();
    }
  });

  it("does not interrupt a turn that ended while the repost was still being verified", async () => {
    const guildId = "300000000000000062";
    const hostDiscId = "100000000000000062";
    let signalLookupStarted: () => void = () => {};
    const lookupStarted = new Promise<void>((resolve) => {
      signalLookupStarted = resolve;
    });
    let answerLookup: () => void = () => {};
    const lookupAnswered = new Promise<void>((resolve) => {
      answerLookup = resolve;
    });
    const stubs = stubVerifiedPluralKitRepost({
      hostDiscId,
      originalMessageId: "original-follow-up-2",
      beforeAnswer: async () => {
        signalLookupStarted();
        await lookupAnswered;
      },
    });
    try {
      holdOriginal(hostDiscId, "original-follow-up-2");
      const lockEntry = lockHostTurn(hostDiscId);

      const pendingAdmission = evaluateChatAdmission(makeRepostIncoming(guildId, "repost-follow-up-2"));
      await lookupStarted;
      releaseChannelLockAndReplayQueue({
        channelId,
        lockEntry,
        completedMessageId: "active-host-turn",
        handleStopResponse: async () => {},
        processQueuedMessage: async () => {},
      });
      answerLookup();
      const admission = await pendingAdmission;

      expect(admission.disposition === "run" ? admission.userDiscId : admission.reason).toBe(hostDiscId);
      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(false);
      expect(lockEntry.messageQueue).toHaveLength(0);
    } finally {
      stubs.restore();
    }
  });
});
