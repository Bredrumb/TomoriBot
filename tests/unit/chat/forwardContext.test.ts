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
  /** Origin channel of the forward reference. Defaults to a readable stub channel. */
  sourceChannelId?: string;
  /** Message returned when the forward reference is re-fetched (nested-forward walk). */
  originMessage?: Message;
  /** When true, the origin channel cannot be fetched, so simulates a missing-permission origin. */
  originUnreachable?: boolean;
}): Message {
  const attachments = new Collection<string, unknown>();
  for (const attachment of overrides.snapshotAttachments ?? []) {
    attachments.set(attachment.id, attachment);
  }

  const snapshot = {
    // Mirrors discord.js MessageSnapshot: identity fields (id/author/channelId)
    // are always null, so only content/attachments/embeds/etc. survive the forward.
    channelId: null,
    content: overrides.snapshotContent ?? "",
    attachments,
    components: undefined,
    embeds: [],
    stickers: new Collection<string, unknown>(),
    author: null,
    member: null,
  };

  // Stub client: resolveForwardChain re-fetches the reference target only when the
  // snapshot is empty, which is the nested-forward signature.
  const client = {
    channels: {
      cache: { get: () => undefined },
      fetch: async () => {
        if (overrides.originUnreachable) throw new Error("Missing Access");
        return {
          isTextBased: () => true,
          messages: { fetch: async () => overrides.originMessage },
        };
      },
    },
  };

  return {
    id: overrides.id,
    client,
    reference: {
      type: MessageReferenceType.Forward,
      messageId: overrides.originalMessageId,
      channelId: overrides.sourceChannelId ?? "source-channel",
    },
    messageSnapshots: new Collection([["0", snapshot]]),
  } as unknown as Message;
}

async function runBuildForwardContext(message: Message) {
  const imageAttachments: SimplifiedMessageForContext["imageAttachments"] = [];
  const videoAttachments: SimplifiedMessageForContext["videoAttachments"] = [];
  const registeredIds: string[] = [];
  const messageIdMap = {
    register: (id: string) => {
      registeredIds.push(id);
      return id;
    },
  } as unknown as MessageIdMap;

  const result = await buildForwardContext({
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
  test("extracts images from an image-only forward and synthesizes content", async () => {
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

    const { result, imageAttachments } = await runBuildForwardContext(message);

    expect(imageAttachments).toHaveLength(1);
    expect(imageAttachments[0]?.proxyUrl).toBe("https://media.discordapp.net/attachments/2/3/cat.png");
    expect(result.content).toContain("forwarded a message");
    expect(result.content).toContain("(with 1 image)");
    expect(result.remoteMediaSourceKind).toBe("forwarded");
  });

  test("registers the wrapper message id as the media source, not the original's", async () => {
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

    const { result, registeredIds } = await runBuildForwardContext(message);

    expect(result.mediaSourceMessageIds).toEqual(["wrapper-1"]);
    expect(registeredIds).toContain("wrapper-1");
    expect(registeredIds).not.toContain("original-999");
  });

  test("registers no media source for a text-only forward", async () => {
    const message = makeForwardMessage({
      id: "wrapper-1",
      originalMessageId: "original-999",
      snapshotContent: "hello from another channel",
    });

    const { result, imageAttachments } = await runBuildForwardContext(message);

    expect(imageAttachments).toHaveLength(0);
    expect(result.mediaSourceMessageIds).toEqual([]);
    expect(result.remoteMediaSourceKind).toBeUndefined();
    expect(result.content).toContain("hello from another channel");
  });

  test("recovers media from a forward of a forward", async () => {
    // Regression: Discord's message_snapshots is non-recursive, so forwarding an
    // already-forwarded message hands the bot an EMPTY snapshot, so no text, no media.
    // The wrapper's own reference still points at the intermediate forward, whose
    // snapshots hold the original image, so the chain must be re-fetched.
    const intermediateForward = makeForwardMessage({
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

    const outerForward = makeForwardMessage({
      id: "wrapper-2",
      originalMessageId: "wrapper-1",
      sourceChannelId: "middle-channel",
      originMessage: intermediateForward,
    });

    const { result, imageAttachments, registeredIds } = await runBuildForwardContext(outerForward);

    expect(imageAttachments).toHaveLength(1);
    expect(imageAttachments[0]?.proxyUrl).toBe("https://media.discordapp.net/attachments/2/3/cat.png");
    expect(result.content).toContain("(with 1 image)");
    expect(result.remoteMediaSourceKind).toBe("forwarded");
    // The OUTERMOST wrapper is what resolves in the current channel, so tools must
    // key off it, so re-resolving it walks the same chain again to reach the bytes.
    expect(result.mediaSourceMessageIds).toEqual(["wrapper-2"]);
    expect(registeredIds).toContain("wrapper-2");
  });

  test("reports an unreachable nested forward instead of an empty message", async () => {
    // Regression: when the origin channel cannot be read, the old code emitted
    // "[System: No text content was included]" with no media ID. That asserts a
    // forward the model cannot see, which led it to invent a media_id and fail.
    const outerForward = makeForwardMessage({
      id: "wrapper-2",
      originalMessageId: "wrapper-1",
      sourceChannelId: "middle-channel",
      originUnreachable: true,
    });

    const { result, imageAttachments } = await runBuildForwardContext(outerForward);

    expect(imageAttachments).toHaveLength(0);
    expect(result.mediaSourceMessageIds).toEqual([]);
    expect(result.remoteMediaSourceKind).toBeUndefined();
    expect(result.content).toContain("itself a forward");
    expect(result.content).not.toContain("No text content was included");
  });
});
