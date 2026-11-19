import { describe, expect, it } from "bun:test";
import { escapeRegExp, wrapWithWordBoundary } from "@/utils/text/processors/regexUtils";

const COMBINING_DIAERESIS = String.fromCharCode(0x0308);

function matches(pattern: string, content: string): boolean {
  return new RegExp(wrapWithWordBoundary(escapeRegExp(pattern)), "iu").test(content);
}

describe("wrapWithWordBoundary", () => {
  it("matches a standalone occurrence regardless of surrounding punctuation or spacing", () => {
    for (const content of ["lex", "hey lex", "lex!", "(lex)", "lex-word", "say 'lex' now"]) {
      expect(matches("lex", content)).toBe(true);
    }
  });

  it("rejects an occurrence abutting an ASCII word character", () => {
    for (const content of ["xlex", "lexis", "lex1", "1lex", "_lex", "lex_"]) {
      expect(matches("lex", content)).toBe(false);
    }
  });

  it("rejects an occurrence abutting a precomposed accented letter", () => {
    expect(matches("lex", "prälex")).toBe(false);
  });

  it("rejects an occurrence abutting a decomposed accented letter", () => {
    expect(matches("lex", `pra${COMBINING_DIAERESIS}lex`)).toBe(false);
  });

  it("rejects an occurrence abutting a non-Latin letter", () => {
    expect(matches("lex", "лlex")).toBe(false);
    expect(matches("lex", "lexдом")).toBe(false);
  });

  it("builds under the u flag for every character escapeRegExp escapes", () => {
    // Trigger words build "u"-flag regexes that throw on identity escapes, so these cases pin the escape set and
    // edge shapes without a slow full-Unicode sweep.
    const characters = [
      ".",
      "*",
      "+",
      "?",
      "^",
      "$",
      "{",
      "}",
      "(",
      ")",
      "|",
      "[",
      "]",
      "\\",
      String.fromCharCode(0xd800),
      String.fromCodePoint(0x1f600),
      COMBINING_DIAERESIS,
      String.fromCharCode(0x200b),
      String.fromCharCode(0x30fb),
    ];

    for (const character of characters) {
      expect(() => new RegExp(wrapWithWordBoundary(escapeRegExp(`a${character}b`)), "iu")).not.toThrow();
    }
  });
});
