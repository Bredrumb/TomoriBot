import { describe, expect, it } from "bun:test";
import { buildOpenAICompatibleMessages } from "@/providers/openaiCompatible/openaiCompatibleMessageBuilder";
import type { StructuredContextItem } from "@/types/misc/context";

// Golden-body regression coverage for the OpenAI-compatible message builder, which every
// OpenAI-compatible provider (deepseek, zai, zaicoding, custom, nvidia, ...) shares. Asserts the
// always-on assistant-media relocation produces byte-identical output after the refactor — the
// canonical wording matches the builder's previous wording, so these providers are unchanged.
//
// Inline base64 image parts are used so no network/image-processing runs in the test.
function inlineImagePart(data: string): StructuredContextItem["parts"][number] {
  return {
    type: "image",
    inlineData: { mimeType: "image/png", data },
  } as unknown as StructuredContextItem["parts"][number];
}

describe("buildOpenAICompatibleMessages — assistant media relocation (golden)", () => {
  it("relocates a bot image into a synthetic user turn after the assistant text turn", async () => {
    const contextItems: StructuredContextItem[] = [
      { role: "user", parts: [{ type: "text", text: "Hello" }] },
      { role: "model", parts: [{ type: "text", text: "Hi there" }, inlineImagePart("AAA")] },
    ];

    const messages = await buildOpenAICompatibleMessages({
      adapterName: "TestAdapter",
      contextItems,
      currentTurnModelParts: [],
      seesImages: true,
    });

    expect(messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      {
        role: "user",
        content: [
          { type: "text", text: "[System: The previous assistant message included the following image.]" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
        ],
      },
    ]);
  });

  it("drops an image-only assistant turn, keeping only the relocated user turn (plural wording)", async () => {
    const contextItems: StructuredContextItem[] = [
      { role: "user", parts: [{ type: "text", text: "show me" }] },
      { role: "model", parts: [inlineImagePart("AAA"), inlineImagePart("BBB")] },
    ];

    const messages = await buildOpenAICompatibleMessages({
      adapterName: "TestAdapter",
      contextItems,
      currentTurnModelParts: [],
      seesImages: true,
    });

    expect(messages).toEqual([
      { role: "user", content: "show me" },
      {
        role: "user",
        content: [
          { type: "text", text: "[System: The previous assistant message included the following images.]" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
          { type: "image_url", image_url: { url: "data:image/png;base64,BBB" } },
        ],
      },
    ]);
  });

  it("leaves a text-only assistant turn as a flat string (no relocation)", async () => {
    const contextItems: StructuredContextItem[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      { role: "model", parts: [{ type: "text", text: "hello" }] },
    ];

    const messages = await buildOpenAICompatibleMessages({
      adapterName: "TestAdapter",
      contextItems,
      currentTurnModelParts: [],
      seesImages: true,
    });

    expect(messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("appends the current-turn prefill as a trailing assistant string", async () => {
    const messages = await buildOpenAICompatibleMessages({
      adapterName: "TestAdapter",
      contextItems: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      currentTurnModelParts: [{ text: "Sure, " }],
      seesImages: true,
    });

    expect(messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Sure, " },
    ]);
  });
});
