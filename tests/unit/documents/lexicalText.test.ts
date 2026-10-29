import { describe, expect, it } from "bun:test";
import { buildDocumentLexicalQuery, buildDocumentLexicalText } from "@/utils/documents/lexicalText";
import { RAG_QUERIES } from "../../fixtures/rag";

const terms = (text: string) => text.trim().split(/\s+/);

describe("document lexical tokenizer", () => {
  it("indexes overlapping CJK bigrams and Han unigrams, and queries bigrams with AND input", () => {
    const stored = terms(buildDocumentLexicalText("", "月湊灯台"));
    expect(stored).toEqual(expect.arrayContaining(["月", "湊", "灯", "台", "月湊", "湊灯", "灯台"]));
    expect(terms(buildDocumentLexicalQuery("月湊灯台"))).toEqual(["月湊", "湊灯", "灯台"]);
    expect(terms(buildDocumentLexicalQuery("澪"))).toEqual(["澪"]);
  });

  it("retains kana bigrams and handles supplementary Han characters", () => {
    expect(terms(buildDocumentLexicalQuery("しおつむぎ"))).toEqual(["しお", "おつ", "つむ", "むぎ"]);
    expect(terms(buildDocumentLexicalQuery("𠮷野"))).toEqual(["𠮷野"]);
    expect(terms(buildDocumentLexicalText("", "𠮷野"))).toContain("𠮷");
  });

  it("preserves non-CJK query input and does not cap AND terms", () => {
    for (const query of RAG_QUERIES) {
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query.text)) continue;
      expect(buildDocumentLexicalQuery(query.text)).toBe(query.text.normalize("NFC"));
    }
    const query = Array.from({ length: 80 }, (_, index) => `term${index}`).join(" ");
    expect(buildDocumentLexicalQuery(query)).toBe(query);
  });

  it("includes the document name and optional heading without crossing field boundaries", () => {
    const built = terms(buildDocumentLexicalText("月湊", "北岸", "灯台"));
    expect(built).toEqual(expect.arrayContaining(["月湊", "北岸", "灯台"]));
    expect(built).not.toContain("湊灯");
    expect(built).not.toContain("台北");
  });
});
