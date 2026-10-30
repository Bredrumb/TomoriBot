import { describe, expect, it, spyOn } from "bun:test";
import { buildGeminiImagePromptParts } from "@/providers/utils/geminiImageParts";
import {
  buildGifToolHint,
  buildGifUrlPlaceholder,
  buildInlineGifPlaceholder,
} from "@/providers/utils/gifContextPlaceholders";
import { isSystemInstructionContextItem, SYSTEM_INSTRUCTION_CONTEXT_TAGS } from "@/providers/utils/strictChatCompat";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { StreamContext } from "@/types/stream/interfaces";

import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { GoogleStreamAdapter } from "@/providers/google/googleStreamAdapter";
import { buildOpenAICompatibleMessages } from "@/providers/openaiCompatible/openaiCompatibleMessageBuilder";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { VertexStreamAdapter } from "@/providers/vertex/vertexStreamAdapter";
import { clearImageCache } from "@/utils/image/imageProcessor";
import * as downloads from "@/utils/security/safeDownload";
import { stubLogMembers } from "../../helpers/mockSurface";

const reference = { mimeType: "image/png", data: "aGVsbG8=" };

describe("shared GIF context placeholders", () => {
  it("keeps a Tenor slug in the production placeholder and drops any other GIF URL", () => {
    expect(buildGifUrlPlaceholder("https://tenor.com/view/cat-typing-12345")).toContain(
      "https://tenor.com/view/cat-typing-12345",
    );
    expect(buildGifUrlPlaceholder("https://cdn.discordapp.com/attachments/1/2/cat.gif")).toBe(
      "[System: This message contains a GIF. GIF processing disabled in production.]",
    );
  });

  it("names inline GIF data in its own production placeholder", () => {
    expect(buildInlineGifPlaceholder()).toBe(
      "[System: This context contains inline GIF data. GIF processing disabled in production.]",
    );
  });

  /**
   * The hint registers the message ID with the media map so `process_gif` can resolve it later. The
   * registration is the part a caller cannot reconstruct, so it is asserted alongside the wording.
   */
  it("registers the message ID while building the development hint", () => {
    const registered: Array<{ messageId: string; kind: string }> = [];
    const messageIdMap = {
      register: (messageId: string, kind: string) => {
        registered.push({ messageId, kind });
        return `media-${messageId}`;
      },
    } as unknown as StreamContext["messageIdMap"];

    const hint = buildGifToolHint({ messageId: "m-1", messageIdMap, subject: "a GIF" });

    expect(registered).toEqual([{ messageId: "m-1", kind: "media" }]);
    expect(hint).toBe(
      "[System: This message (ID: media-m-1) contains a GIF. Use process_gif tool with this message ID to process it if needed for context.]",
    );
  });

  it("falls back to an unknown ID when the context item carries no message ID", () => {
    const hint = buildGifToolHint({ subject: "inline GIF data" });

    expect(hint).toContain("(ID: unknown)");
    expect(hint).toContain("contains inline GIF data");
  });
});

describe("shared Gemini image prompt parts", () => {
  it("places reference images before the prompt they describe", () => {
    expect(buildGeminiImagePromptParts("draw a cat", [reference])).toEqual([
      { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } },
      "draw a cat",
    ]);
  });

  it("sends the prompt alone when the request has no references", () => {
    expect(buildGeminiImagePromptParts("draw a cat")).toEqual(["draw a cat"]);
  });
});

describe("shared system-instruction routing", () => {
  function makeItem(role: string, metadataTag?: ContextItemTag): StructuredContextItem {
    return { role, parts: [{ type: "text", text: "content" }], metadataTag } as StructuredContextItem;
  }

  it("routes the standing system tags to the instruction channel", () => {
    for (const tag of SYSTEM_INSTRUCTION_CONTEXT_TAGS) {
      expect(isSystemInstructionContextItem(makeItem("user", tag))).toBe(true);
    }
  });

  it("routes dialogue tags and untagged turns to dialogue", () => {
    expect(isSystemInstructionContextItem(makeItem("user", ContextItemTag.DIALOGUE_HISTORY))).toBe(false);
    expect(isSystemInstructionContextItem(makeItem("user", ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION))).toBe(
      false,
    );
    expect(isSystemInstructionContextItem(makeItem("user"))).toBe(false);
    expect(isSystemInstructionContextItem(makeItem("model"))).toBe(false);
  });

  it("treats a system-role item as instruction regardless of its tag", () => {
    expect(isSystemInstructionContextItem(makeItem("system"))).toBe(true);
    expect(isSystemInstructionContextItem(makeItem("system", ContextItemTag.DIALOGUE_SAMPLE))).toBe(true);
  });
});

stubLogMembers({ info: () => {}, success: () => {} });

const imageAssemblers = [
  {
    name: "Google",
    build: (contextItems: StructuredContextItem[]) =>
      new GoogleStreamAdapter()["assembleGoogleContext"](contextItems, []),
    gifs: true,
    fallback: true,
  },
  {
    name: "Vertex",
    build: (contextItems: StructuredContextItem[]) =>
      new VertexStreamAdapter()["assembleVertexContext"](contextItems, []),
    gifs: true,
    fallback: true,
  },
  {
    name: "OpenRouter",
    build: (contextItems: StructuredContextItem[]) =>
      new OpenrouterStreamAdapter()["assembleOpenrouterContext"](contextItems, []),
    gifs: true,
    fallback: true,
  },
  {
    name: "Anthropic",
    build: (contextItems: StructuredContextItem[]) =>
      new AnthropicStreamAdapter()["assembleAnthropicContext"](contextItems, []),
    gifs: false,
    fallback: false,
  },
  {
    name: "OpenAI compatible",
    build: (contextItems: StructuredContextItem[]) =>
      buildOpenAICompatibleMessages({
        adapterName: "TestAdapter",
        contextItems,
        currentTurnModelParts: [],
        seesImages: true,
      }),
    gifs: true,
    fallback: true,
  },
];

it.each(imageAssemblers)("$name keeps payload order with four concurrent image downloads", async ({
  build,
  gifs,
  fallback,
}) => {
  const imageUrls = Array.from(
    { length: 5 },
    (_, index) => `https://media.discordapp.net/attachments/1/${index}/image.png`,
  );
  const fallbackUrl = "https://cdn.discordapp.com/attachments/1/1/image.png";
  const resultFor = (imageUrl: string): downloads.SafeDownloadResult => {
    if (fallback && imageUrl === imageUrls[1]) return { success: false, error: "network_error" };
    const index = imageUrl === fallbackUrl ? 1 : imageUrls.indexOf(imageUrl);
    return { success: true, buffer: Buffer.from(`image-${index}`), contentType: "image/png" };
  };
  const imagePart = (index: number): StructuredContextItem["parts"][number] => ({
    type: "image",
    uri: imageUrls[index],
    mimeType: "image/png",
    ...(fallback && index === 1 ? { fallbackUri: fallbackUrl } : {}),
  });
  const parts: StructuredContextItem["parts"] = [
    { type: "text", text: "before" },
    imagePart(0),
    imagePart(1),
    { type: "text", text: "middle" },
    imagePart(2),
    ...(gifs ? [{ type: "image" as const, uri: "https://example.com/animation.gif", mimeType: "image/gif" }] : []),
    imagePart(3),
    imagePart(4),
    { type: "text", text: "after" },
  ];
  const items: StructuredContextItem[] = [{ role: "user", parts }];
  clearImageCache();
  const download = spyOn(downloads, "safeDownload").mockImplementation(async (imageUrl) => resultFor(imageUrl));
  try {
    const baseline = JSON.stringify(await build(items));
    const payloadData = imageUrls.map((_, index) => Buffer.from(`image-${index}`).toString("base64"));
    let lastOffset = -1;
    for (const value of [
      "before",
      payloadData[0],
      payloadData[1],
      "middle",
      payloadData[2],
      payloadData[3],
      payloadData[4],
      "after",
    ]) {
      const offset = baseline.indexOf(value, lastOffset + 1);
      expect(offset).toBeGreaterThan(lastOffset);
      lastOffset = offset;
    }
    clearImageCache();
    download.mockClear();
    const pending = new Map<string, ReturnType<typeof Promise.withResolvers<downloads.SafeDownloadResult>>>();
    const firstWave = Promise.withResolvers<void>();
    const fifthImage = Promise.withResolvers<void>();
    const fallbackStarted = Promise.withResolvers<void>();
    let active = 0;
    let maxActive = 0;
    download.mockImplementation((imageUrl) => {
      const deferred = Promise.withResolvers<downloads.SafeDownloadResult>();
      pending.set(imageUrl, deferred);
      active++;
      maxActive = Math.max(maxActive, active);
      if (pending.size === 4) firstWave.resolve();
      if (imageUrl === imageUrls[4]) fifthImage.resolve();
      if (imageUrl === fallbackUrl) fallbackStarted.resolve();
      return deferred.promise.finally(() => active--);
    });
    const building = build(items);
    await firstWave.promise;
    expect(active).toBe(4);
    expect(pending.has(imageUrls[4])).toBe(false);
    pending.get(imageUrls[3])?.resolve(resultFor(imageUrls[3]));
    await fifthImage.promise;
    for (const index of [4, 2, 1]) pending.get(imageUrls[index])?.resolve(resultFor(imageUrls[index]));
    if (fallback) {
      await fallbackStarted.promise;
      pending.get(fallbackUrl)?.resolve(resultFor(fallbackUrl));
    }
    pending.get(imageUrls[0])?.resolve(resultFor(imageUrls[0]));
    expect(JSON.stringify(await building)).toBe(baseline);
    expect(maxActive).toBe(4);
    expect(download).toHaveBeenCalledTimes(fallback ? 6 : 5);
    expect(pending.has("https://example.com/animation.gif")).toBe(false);
  } finally {
    download.mockRestore();
    clearImageCache();
  }
});
