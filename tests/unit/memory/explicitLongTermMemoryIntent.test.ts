import { beforeAll, describe, expect, it } from "bun:test";
import { hasExplicitLongTermMemoryIntent } from "@/utils/memory/explicitLongTermMemoryIntent";
import { initializeLocalizer } from "@/utils/text/localizer";
import { EXPLICIT_MEMORY_PACK_KEY, getIntentPackUnion } from "@/utils/text/localeIntentPacks";

// The phrase lists that were hardcoded before they moved into the locale trees. Matching must not
// change for either shipped language.
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

beforeAll(async () => {
  await initializeLocalizer();
});

describe("explicit long-term memory intent", () => {
  it("unions exactly the previous English and Japanese phrases", () => {
    expect([...getIntentPackUnion(EXPLICIT_MEMORY_PACK_KEY)].sort()).toEqual(
      [...PREVIOUS_ENGLISH_PHRASES, ...PREVIOUS_JAPANESE_PHRASES].sort(),
    );
  });

  it("matches every previous phrase inside a sentence, after NFKC and case folding", () => {
    for (const phrase of [...PREVIOUS_ENGLISH_PHRASES, ...PREVIOUS_JAPANESE_PHRASES]) {
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
