import { beforeAll, describe, expect, it } from "bun:test";
import { hasExplicitLongTermMemoryIntent } from "@/utils/memory/explicitLongTermMemoryIntent";
import { initializeLocalizer } from "@/utils/text/localizer";
import { EXPLICIT_MEMORY_PACK_KEY, getIntentPackUnion } from "@/utils/text/localeIntentPacks";

// The phrase lists that were hardcoded before they moved into the locale trees. Keep their matching
// behavior stable while asserting every shipped locale contributes its registered phrases.
const PREVIOUS_ENGLISH_PHRASES = [
  "remember",
  "don't forget",
  "note",
  "commit to memory",
  "for future conversations",
  "for future reference",
];
const PREVIOUS_JAPANESE_PHRASES = [
  "覚えておいて",
  "覚えといて",
  "これを覚えて",
  "これ覚えて",
  "それを覚えて",
  "それ覚えて",
  "忘れないで",
  "今後のために覚えて",
  "後で使えるように覚えて",
];
const JAPANESE_CATCH_UP_PHRASES = [
  "これ覚えといて",
  "これ忘れないで",
  "このこと覚えて",
  "この件を記憶",
  "頭に入れといて",
  "心に留めて",
  "覚えといてね",
  "忘れちゃだめ",
  "忘れないようにして",
  "今後も覚えてて",
  "記憶に残して",
  "メモっといて",
  "しっかり覚えて",
  "大事なこととして覚えて",
  "覚えてて",
  "覚えとい",
  "覚えてお",
  "忘れんな",
  "忘れないでね",
];
const ZH_TW_PHRASES = [
  "記住",
  "記住這",
  "記住我",
  "記下來",
  "別忘了",
  "不要忘記",
  "請記住",
  "幫我記住",
  "幫我記",
  "記在心裡",
  "存進記憶",
  "長期記憶",
];
const PT_BR_PHRASES = [
  "lembre",
  "não se esqueça",
  "não esqueça",
  "não esquece",
  "nao esquece",
  "guarda na memória",
  "guarda na memoria",
  "note",
  "guarde na memória",
  "para conversas futuras",
  "para referência futura",
];
const ES_419_PHRASES = [
  "recuerda que*",
  "recuerda esto*",
  "acuérdate de*",
  "acuerdate de*",
  "no olvides que*",
  "no se te olvide*",
  "que no se te olvide*",
  "guarda en tu memoria*",
  "guarda esto en tu memoria*",
  "guárdalo en tu memoria*",
  "guardalo en tu memoria*",
  "memoriza*",
  "ten presente que*",
  "ten en cuenta que*",
  "anota que*",
  "para futuras conversaciones",
];

beforeAll(async () => {
  await initializeLocalizer();
});

describe("explicit long-term memory intent", () => {
  it("unions the registered phrases from every shipped locale", () => {
    expect([...getIntentPackUnion(EXPLICIT_MEMORY_PACK_KEY)].sort()).toEqual(
      [
        ...new Set([
          ...PREVIOUS_ENGLISH_PHRASES,
          ...PREVIOUS_JAPANESE_PHRASES,
          ...JAPANESE_CATCH_UP_PHRASES,
          ...ZH_TW_PHRASES,
          ...PT_BR_PHRASES,
          ...ES_419_PHRASES,
        ]),
      ].sort(),
    );
  });

  it("matches every registered phrase inside a sentence, after NFKC and case folding", () => {
    for (const phrase of [
      ...PREVIOUS_ENGLISH_PHRASES,
      ...PREVIOUS_JAPANESE_PHRASES,
      ...JAPANESE_CATCH_UP_PHRASES,
      ...ZH_TW_PHRASES,
      ...PT_BR_PHRASES,
      ...ES_419_PHRASES,
    ]) {
      expect(hasExplicitLongTermMemoryIntent(`ok ${phrase} this`)).toBe(true);
    }
    expect(hasExplicitLongTermMemoryIntent("ＲＥＭＥＭＢＥＲ   this")).toBe(true);
  });

  it("ignores text without an explicit memory request", () => {
    expect(hasExplicitLongTermMemoryIntent("hello there")).toBe(false);
    expect(hasExplicitLongTermMemoryIntent("   ")).toBe(false);
    expect(hasExplicitLongTermMemoryIntent(null)).toBe(false);
  });
});
