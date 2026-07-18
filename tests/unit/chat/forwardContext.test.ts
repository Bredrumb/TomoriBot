import { describe, expect, test } from "bun:test";
import { Collection, MessageReferenceType, type Message } from "discord.js";
import { buildForwardContext } from "@/utils/chat/contextMedia";
import type { SimplifiedMessageForContext } from "@/utils/text/contextBuilder";
import type { MessageIdMap } from "@/utils/text/messageIdMap";

/**
 * Build a minimal forwarded (wrapper) message. Only the fields read by
 * `buildForwardContext` are populated; the rest is cast away.
 */
function makeForwardMessage(overrides: {
  id: string;
  originalMessageId: string;
  snapshotContent?: string;
  snapshotAttachments?: Array<{ id: string; name: string; url: string; proxyURL: string; contentType: string }>;
}): Message {
  const attachments = new Collection<string, unknown>();
  for (const attachment of overrides.snapshotAttachments ?? []) {
    attachments.set(attachment.id, attachment);
  }

  const snapshot = {
    // Mirrors discord.js MessageSnapshot: identity fields (id/author/channelId)
    // are always null — only content/attachments/embeds/etc. survive the forward.
    channelId: null,
    content: overrides.snapshotContent ?? "",
    attachments,
    components: undefined,
    embeds: [],
    author: null,
    member: null,
  };

  return {
    id: overrides.id,
    reference: {
      type: MessageReferenceType.Forward,
      messageId: overrides.originalMessageId,
      channelId: "source-channel",
    },
    messageSnapshots: new Collection([["0", snapshot]]),
  } as unknown as Message;
}

function runBuildForwardContext(message: Message) {
  const imageAttachments: SimplifiedMessageForContext["imageAttachments"] = [];
  const videoAttachments: SimplifiedMessageForContext["videoAttachments"] = [];
  const registeredIds: string[] = [];
  const messageIdMap = {
    register: (id: string) => {
      registeredIds.push(id);
      return id;
    },
  } as unknown as MessageIdMap;

  const result = buildForwardContext({
    message,
    content: "",
    imageAttachments,
    videoAttachments,
    messageIdMap,
    forwarderName: "Forwarder",
    clientUserId: "bot-id",
    tomoriNickname: "Tomori",
    selfDebugEnabled: false,
  });

  return { result, imageAttachments, videoAttachments, registeredIds };
}

describe("buildForwardContext", () => {
  test("extracts images from an image-only forward and synthesizes content", () => {
    // Regression: forwarding a message with ONLY images (no text) must still
    // produce non-empty content so the message survives the empty-message drop
    // check in simplifyMessage, and the snapshot image must be extracted.
    const message = makeForwardMessage({
      id: "wrapper-1",
      originalMessageId: "original-999",
      snapshotAttachments: [
        {
          id: "1",
          name: "cat.png",
          url: "https://cdn.discordapp.com/attachments/2/3/cat.png",
          proxyURL: "https://media.discordapp.net/attachments/2/3/cat.png",
          contentType: "image/png",
        },
      ],
    });

    const { result, imageAttachments } = runBuildForwardContext(message);

    expect(imageAttachments).toHaveLength(1);
    expect(imageAttachments[0]?.proxyUrl).toBe("https://media.discordapp.net/attachments/2/3/cat.png");
    expect(result.content).toContain("forwarded a message");
    expect(result.content).toContain("(with 1 image)");
    expect(result.remoteMediaSourceKind).toBe("forwarded");
  });

  test("registers the wrapper message id as the media source, not the original's", () => {
    // Regression: the original message lives in the SOURCE channel, so tools
    // resolving media IDs against the current channel could never fetch it. The
    // wrapper id resolves in-channel and its snapshots carry the same media.
    const message = makeForwardMessage({
      id: "wrapper-1",
      originalMessageId: "original-999",
      snapshotAttachments: [
        {
          id: "1",
          name: "cat.png",
          url: "https://cdn.discordapp.com/attachments/2/3/cat.png",
          proxyURL: "https://media.discordapp.net/attachments/2/3/cat.png",
          contentType: "image/png",
        },
      ],
    });

    const { result, registeredIds } = runBuildForwardContext(message);

    expect(result.mediaSourceMessageIds).toEqual(["wrapper-1"]);
    expect(registeredIds).toContain("wrapper-1");
    expect(registeredIds).not.toContain("original-999");
  });

  test("registers no media source for a text-only forward", () => {
    const message = makeForwardMessage({
      id: "wrapper-1",
      originalMessageId: "original-999",
      snapshotContent: "hello from another channel",
    });

    const { result, imageAttachments } = runBuildForwardContext(message);

    expect(imageAttachments).toHaveLength(0);
    expect(result.mediaSourceMessageIds).toEqual([]);
    expect(result.remoteMediaSourceKind).toBeUndefined();
    expect(result.content).toContain("hello from another channel");
  });
});
