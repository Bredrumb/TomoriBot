import { describe, expect, it } from "bun:test";
import { normalizeNovelAIContextText } from "@/providers/novelai/messageNormalization";
import { fitNovelAIPrompt } from "@/providers/novelai/promptFitting";
import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { createNovelAITokenizerEncoder } from "@/utils/provider/localTokenizerRegistry";
import { createPersona } from "../../helpers/fixtures";
import { collectCaseFailures } from "../../helpers/localeCases";
import { attachPersonaMentionMapToContextItems, buildPersonaMentionCatalog } from "@/utils/text/personaMentionHandles";

function turn(body: string): StructuredContextItem {
  return {
    role: "user",
    sender: { type: "user", name: "mirri" },
    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
    completionText: `mirri: ${body}`,
    parts: [{ type: "text", text: `mirri: ${body}` }],
  };
}

function normalize(item: StructuredContextItem): string {
  return normalizeNovelAIContextText(item, ["Juno"]);
}

describe("NovelAI message normalization", () => {
  it("handles long unclosed face-like text without changing its contents", () => {
    const body = `hello (${"_ ".repeat(2000)}unfinished`;
    expect(normalize(turn(body))).toBe(`Mirri: H${body.slice(1)}.`);
  });
  it("normalizes Latin message boundaries while preserving protected content", () => {
    const cases = collectCaseFailures();
    for (const [body, expected] of [
      ["hello there", "Hello there."],
      ["HELLO", "HELLO."],
      ["hello!", "Hello!"],
      ["really?!", "Really?!"],
      ["wait...", "Wait..."],
      ['"hello!"', '"hello!"'],
      ["  hello  ", "  Hello.  "],
      ["", ""],
      ["```ts\nconst hello = 1\n```", "```ts\nconst hello = 1\n```"],
      ["~~~ts\nconst hello = 1\n~~~", "~~~ts\nconst hello = 1\n~~~"],
      ["`hello` there", "`hello` there."],
      ["use `lowerCase` here", "Use `lowerCase` here."],
      ["use `lowerCase`", "Use `lowerCase`"],
      ["use `unfinished", "Use `unfinished"],
      ["https://example.com/help", "https://example.com/help"],
      ["see https://example.com/help", "See https://example.com/help"],
      ["<https://example.com/help>", "<https://example.com/help>"],
      ["<@123456789012345678> hello", "<@123456789012345678> hello"],
      ["@mirri hello", "@mirri hello"],
      ["🙂 hello", "🙂 hello"],
      ["1️⃣ hello", "1️⃣ hello"],
      ["hello 🙂", "Hello 🙂"],
      ["hello 🇻🇳", "Hello 🇻🇳"],
      ["hello 👍🏽", "Hello 👍🏽"],
      ["hello 1️⃣", "Hello 1️⃣"],
      ["hello <:wave:123456789012345678>", "Hello <:wave:123456789012345678>"],
      ["hello (^_^)", "Hello (^_^)"],
      ["hello ^_^", "Hello ^_^"],
      ["hello :)", "Hello :)"],
      ["hello ¯\\_(ツ)_/¯", "Hello ¯\\_(ツ)_/¯"],
      ["hello (づ｡◕‿‿◕｡)づ", "Hello (づ｡◕‿‿◕｡)づ"],
      ["hello (ง'̀-'́)ง", "Hello (ง'̀-'́)ง"],
      ["hello ಠ_ಠ", "Hello ಠ_ಠ"],
      ["こんにちは", "こんにちは"],
      ["你好", "你好"],
      ["đây là tiếng Việt", "Đây là tiếng Việt."],
      ["éclair", "Éclair."],
      ["first line\nsecond line", "First line.\nSecond line."],
      ["hello\n```ts\nconst a = 1\n```", "Hello.\n```ts\nconst a = 1\n```"],
      ["*kneels by the shrine* theres writing here", "*Kneels by the shrine.* Theres writing here."],
      ["*kneels* theres writing here!", "*Kneels.* Theres writing here!"],
    ]) {
      cases.check(body, () => expect(normalize(turn(body))).toBe(`Mirri: ${expected}`));
    }
    cases.expectNoFailures();
  });

  it("ends prose lines without replacing newlines or changing Markdown structure", () => {
    const cases = collectCaseFailures();
    for (const [body, expected] of [
      ["hmph\nso demanding\ntch", "Hmph.\nSo demanding.\nTch."],
      ["hello  \r\n\r\n  welcome back\r\n", "Hello.  \r\n\r\n  Welcome back.\r\n"],
      ["hello?\nreally!\nwait...\noh…\nfine.", "Hello?\nReally!\nWait...\nOh…\nFine."],
      ["*her ears turn pink* fine\nyou're needy", "*Her ears turn pink.* Fine.\nYou're needy."],
      ["*waves\nkisses juno*\nhello", "*Waves.\nKisses Juno.*\nHello."],
      ["**waves\nkisses juno**", "**Waves.\nKisses Juno.**"],
      ["hello\n~~~ts\nconst greeting = 'hello'\n~~~\nbye", "Hello.\n~~~ts\nconst greeting = 'hello'\n~~~\nBye."],
      ["hello\n```ts\nconst greeting = 'hello'\n```\nbye", "Hello.\n```ts\nconst greeting = 'hello'\n```\nBye."],
      ["use `lowerCase` here\nnext line", "Use `lowerCase` here.\nNext line."],
      ["use `lowerCase`\nnext line", "Use `lowerCase`\nNext line."],
      [
        "hello\n    const juno = 'hello'\n\t*juno waves*\nbye",
        "Hello.\n    const juno = 'hello'\n\t*juno waves*\nBye.",
      ],
      [
        "hello\n# heading\n- first item\n* second item\n1. third item\n> quoted line\nbye",
        "Hello.\n# heading\n- first item\n* second item\n1. third item\n> quoted line\nBye.",
      ],
      ["heading\n---\nhello\n***\nbye", "heading\n---\nHello.\n***\nBye."],
      ["heading\n===\nhello", "heading\n===\nHello."],
      ["heading\n--\nhello", "heading\n--\nHello."],
      ["name | value\n--- | ---\nitem | value\nhello", "name | value\n--- | ---\nitem | value\nHello."],
      [
        "hello 🙂\nhttps://example.test/help\n@mirri\nこんにちは\nbye",
        "Hello 🙂\nhttps://example.test/help\n@mirri\nこんにちは\nBye.",
      ],
    ])
      cases.check(body, () => expect(normalize(turn(body))).toBe(`Mirri: ${expected}`));
    cases.expectNoFailures();
  });

  it("polishes formatted prose inside its delimiters and leaves code untouched", () => {
    const cases = collectCaseFailures();
    for (const delimiter of ["*", "**", "***", "_", "__", "~~", "||"]) {
      cases.check(delimiter, () => {
        expect(normalize(turn(`${delimiter}kisses juno${delimiter}`))).toBe(
          `Mirri: ${delimiter}Kisses Juno.${delimiter}`,
        );
        expect(normalize(turn(`${delimiter}hello!${delimiter}`))).toBe(`Mirri: ${delimiter}Hello!${delimiter}`);
        expect(normalize(turn(`${delimiter}hello 🙂${delimiter}`))).toBe(`Mirri: ${delimiter}Hello 🙂${delimiter}`);
        expect(normalize(turn(`${delimiter}你好${delimiter}`))).toBe(`Mirri: ${delimiter}你好${delimiter}`);
        expect(normalize(turn(`i like ${delimiter}games${delimiter}`))).toBe(
          `Mirri: I like ${delimiter}games${delimiter}.`,
        );
      });
    }
    cases.check("code", () => expect(normalize(turn("`*kisses juno*`"))).toBe("Mirri: `*kisses juno*`"));
    cases.check("fence", () =>
      expect(normalize(turn("```md\n**kisses juno**\n```"))).toBe("Mirri: ```md\n**kisses juno**\n```"),
    );
    cases.expectNoFailures();
  });

  it("polishes persona history and sample dialogue without changing the saved text", () => {
    for (const item of [
      { ...turn("hello"), role: "model" as const },
      { ...turn("hello"), sender: { type: "persona" as const, name: "Juno" } },
      { ...turn("hello"), metadataTag: ContextItemTag.DIALOGUE_SAMPLE },
    ]) {
      expect(normalize(item)).toBe("Mirri: Hello.");
      expect(item.parts).toEqual(turn("hello").parts);
    }
  });

  it("restores known persona-name casing without changing code, links, mentions, or longer words", () => {
    const cases = collectCaseFailures();
    for (const [body, expected] of [
      ["hi juno", "Hi Juno."],
      ["hi JUNO. are you there? yes", "Hi Juno. Are you there? Yes."],
      ["junophile and juno's hat", "Junophile and Juno's hat."],
      ["ask `juno` or juno", "Ask `juno` or Juno."],
      ["ask @juno or juno", "Ask @juno or Juno."],
      ["see https://example.test/juno then juno", "See https://example.test/juno then Juno."],
      [
        "hello\n~~~ts\nconst juno = 'hi. there'\n~~~\nask juno",
        "Hello.\n~~~ts\nconst juno = 'hi. there'\n~~~\nAsk Juno.",
      ],
    ])
      cases.check(body, () => expect(normalize(turn(body))).toBe(`Mirri: ${expected}`));
    cases.expectNoFailures();
  });

  it("counts the normalized rendered prompt for every profile without mutating source history", () => {
    const original = turn("đây là tiếng Việt");
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      const profile = getNovelAIProfile(model);
      const prepared = fitNovelAIPrompt({
        contextItems: [original],
        tomoriState: createPersona(),
        profile,
        window: 4096,
      });
      expect(prepared.prompt).toContain("Mirri: Đây là tiếng Việt.");
      expect(prepared.report.inputTokens).toBe(
        createNovelAITokenizerEncoder(profile.tokenizer)(prepared.prompt).length,
      );
      const disabled = fitNovelAIPrompt({
        contextItems: [original],
        tomoriState: createPersona(),
        profile: { ...profile, normalizeMessages: false },
        window: 4096,
      });
      expect(disabled.prompt).toContain(original.completionText ?? "");
    }
    expect(original.parts).toEqual([{ type: "text", text: "mirri: đây là tiếng Việt" }]);
  });

  it("polishes memories, samples, and every speaker independently of the Discord humanizer for all profiles", () => {
    const history = turn("hi juno. is mirri here\nhmph\nso demanding\ntch");
    const samples: StructuredContextItem[] = [
      { role: "user", metadataTag: ContextItemTag.DIALOGUE_SAMPLE, parts: [{ type: "text", text: "hi juno\nhello" }] },
      {
        role: "model",
        metadataTag: ContextItemTag.DIALOGUE_SAMPLE,
        parts: [{ type: "text", text: "juno: hey. welcome back" }],
      },
    ];
    const memory: StructuredContextItem = {
      role: "system",
      metadataTag: ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
      parts: [{ type: "text", text: "juno knows mirri\njuno likes games" }],
      memoryEntries: [{ id: "server:1", text: "juno knows mirri\njuno likes games" }],
    };
    const ownHistory: StructuredContextItem = {
      ...turn("hey. welcome back"),
      role: "model",
      completionText: "juno: hey. welcome back",
      parts: [{ type: "text", text: "juno: hey. welcome back" }],
      sender: { name: "Juno", type: "persona" },
    };
    const otherPersona = createPersona({ persona_id: 2, persona_nickname: "Mirri" });
    const inputs = attachPersonaMentionMapToContextItems(
      [memory, ...samples, history, ownHistory],
      buildPersonaMentionCatalog([createPersona({ persona_nickname: "Juno" }), otherPersona]),
    );
    const before = JSON.stringify(inputs);
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      const prompts = [0, 1, 2, 3].map(
        (humanizerDegree) =>
          fitNovelAIPrompt({
            contextItems: inputs,
            tomoriState: createPersona({ persona_nickname: "Juno", config: { humanizer_degree: humanizerDegree } }),
            profile: getNovelAIProfile(model),
            window: 4096,
          }).prompt,
      );
      for (const prompt of prompts) {
        expect(prompt).toBe(prompts[0]);
        expect(prompt).toContain("Juno knows Mirri.\nJuno likes games.");
        expect(prompt).toContain("Hi Juno.\nHello.");
        expect(prompt).toContain("Hi Juno. Is Mirri here.\nHmph.\nSo demanding.\nTch.");
        expect(prompt).toContain("Juno: Hey. Welcome back.");
      }
    }
    expect(JSON.stringify(inputs)).toBe(before);
  });
});
