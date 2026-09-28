import { describe, expect, it } from "bun:test";
import { buildGeminiImagePromptParts } from "@/providers/utils/geminiImageParts";
import {
  buildGifToolHint,
  buildGifUrlPlaceholder,
  buildInlineGifPlaceholder,
} from "@/providers/utils/gifContextPlaceholders";
import { isSystemInstructionContextItem, SYSTEM_INSTRUCTION_CONTEXT_TAGS } from "@/providers/utils/strictChatCompat";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { StreamContext } from "@/types/stream/interfaces";

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
