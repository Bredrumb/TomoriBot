import { describe, expect, it } from "bun:test";
import { assembleNovelAIPrompt, buildAttgBlock } from "@/providers/novelai/promptRenderers";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { createPersona } from "../../helpers/fixtures";

describe("NovelAI renderers", () => {
  it("places story metadata and character facts before chat samples and history without empty sections", () => {
    const item = (
      metadataTag: ContextItemTag,
      role: StructuredContextItem["role"],
      text: string,
    ): StructuredContextItem => ({ metadataTag, role, parts: [{ type: "text", text }] });
    const items = [
      item(ContextItemTag.SYSTEM_PERSONALITY, "system", "personality-marker"),
      item(ContextItemTag.KNOWLEDGE_SERVER_MEMORIES, "system", "memory-marker"),
      item(ContextItemTag.DIALOGUE_SAMPLE, "user", "sample-in"),
      item(ContextItemTag.DIALOGUE_SAMPLE, "model", "Juno: sample-out"),
      item(ContextItemTag.DIALOGUE_HISTORY, "user", "Mirri: history-marker"),
    ];
    for (const model of ["kayra-v1", "llama-3-erato-v1"]) {
      const attgBlock = buildAttgBlock(createPersona({ nai_attg_tags: "forest", nai_attg_stars: 3 }), model);
      const prompt = assembleNovelAIPrompt(items, "Juno", { attgBlock });
      expect(prompt.split("\n***\n")).toEqual([
        `${attgBlock}\nCharacters:\nJuno\npersonality-marker\nServer Notes:\nmemory-marker`,
        "[ Style: chat ]\nMirri: sample-in\nJuno: sample-out",
        "[ Style: chat ]\nMirri: history-marker",
      ]);
    }
    expect(assembleNovelAIPrompt([], "Juno")).toBe("");
    expect(assembleNovelAIPrompt([], "Juno", { attgBlock: "[ S: 3 ]" })).toBe("[ S: 3 ]");
  });

  it("admits stars for Erato and Xialong, with the client's Xialong default", () => {
    const persona = createPersona();
    expect(buildAttgBlock(persona, "kayra-v1")).toBeNull();
    expect(buildAttgBlock(persona, "llama-3-erato-v1")).toBeNull();
    expect(buildAttgBlock({ ...persona, nai_attg_stars: 3 }, "kayra-v1")).toBeNull();
    expect(buildAttgBlock({ ...persona, nai_attg_stars: 3 }, "llama-3-erato-v1")).toBe("[ S: 3 ]");
    expect(buildAttgBlock(persona, "xialong-v1")).toBe("[ S: 4 ]");
    expect(buildAttgBlock({ ...persona, nai_attg_stars: 2 }, "xialong-v1")).toBe("[ S: 2 ]");
  });
});
