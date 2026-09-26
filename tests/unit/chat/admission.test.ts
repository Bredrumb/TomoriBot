import { describe, expect, it, mock, spyOn } from "bun:test";
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
import { userRepository } from "@/utils/db/repositories/UserRepository";
import type { ChatIncoming } from "@/utils/chat/types";

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
