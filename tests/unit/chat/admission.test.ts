import { describe, expect, it, mock } from "bun:test";
import type { Message } from "discord.js";
import { shouldBlockReplyToOtherBot } from "@/utils/chat/admission";
import type { ChatIncoming } from "@/utils/chat/types";

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
});
