import { describe, expect, it } from "bun:test";
import {
  REASONING_TAG_GLOBAL_RE,
  endsWithReasoningTagPrefix,
  findReasoningTagClose,
  findReasoningTagOpen,
  findTrailingReasoningTagPrefix,
} from "@/providers/utils/reasoningTags";

describe("reasoningTags", () => {
  describe("findReasoningTagOpen / findReasoningTagClose", () => {
    it("matches the conventional tags", () => {
      expect(findReasoningTagOpen("a<think>b")).toEqual({ index: 1, length: 7 });
      expect(findReasoningTagClose("a</think>b")).toEqual({ index: 1, length: 8 });
    });

    it("matches namespaced variants", () => {
      expect(findReasoningTagOpen("a<mm:think>b")).toEqual({ index: 1, length: 10 });
      expect(findReasoningTagClose("a</mm:think>b")).toEqual({ index: 1, length: 11 });
    });

    it("is case-insensitive", () => {
      expect(findReasoningTagOpen("<THINK>")).toEqual({ index: 0, length: 7 });
    });

    it("respects the `from` offset", () => {
      expect(findReasoningTagOpen("<think><think>", 1)).toEqual({ index: 7, length: 7 });
    });

    it("does not match look-alikes", () => {
      expect(findReasoningTagOpen("<thinker>")).toBeNull();
      expect(findReasoningTagOpen("<mm:thinking>")).toBeNull();
      // An open matcher must not match a closing tag.
      expect(findReasoningTagOpen("</think>")).toBeNull();
    });
  });

  describe("findTrailingReasoningTagPrefix", () => {
    it("classifies bare and slashed brackets as close (close-first parity)", () => {
      expect(findTrailingReasoningTagPrefix("text<")?.kind).toBe("close");
      expect(findTrailingReasoningTagPrefix("text</")?.kind).toBe("close");
    });

    it("detects conventional open and close partials", () => {
      expect(findTrailingReasoningTagPrefix("text<thi")).toEqual({ index: 4, kind: "open" });
      expect(findTrailingReasoningTagPrefix("text</thi")).toEqual({ index: 4, kind: "close" });
    });

    it("detects namespaced partials", () => {
      expect(findTrailingReasoningTagPrefix("text<mm:")?.kind).toBe("open");
      expect(findTrailingReasoningTagPrefix("text</mm:thi")?.kind).toBe("close");
      // Namespace still forming, before the colon arrives.
      expect(findTrailingReasoningTagPrefix("text<mm")?.kind).toBe("open");
    });

    it("ignores namespaced tags that cannot become think tags", () => {
      expect(findTrailingReasoningTagPrefix("draw <svg:rect")).toBeNull();
      expect(findTrailingReasoningTagPrefix("a < b")).toBeNull();
    });

    it("ignores overlong trailing runs", () => {
      expect(findTrailingReasoningTagPrefix(`<${"a".repeat(80)}`)).toBeNull();
    });
  });

  describe("endsWithReasoningTagPrefix", () => {
    it("is true for a partial think tag and false otherwise", () => {
      expect(endsWithReasoningTagPrefix("hello </mm:thi")).toBe(true);
      expect(endsWithReasoningTagPrefix("hello world")).toBe(false);
    });
  });

  describe("REASONING_TAG_GLOBAL_RE", () => {
    it("strips conventional and namespaced tags", () => {
      expect("<think>a</think><mm:think>b</mm:think>".replace(REASONING_TAG_GLOBAL_RE, "")).toBe("ab");
    });
  });
});
