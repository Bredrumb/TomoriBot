import { describe, expect, it } from "bun:test";
import { findRegularOverflowFlushIndex, hasIncompleteSemanticMarkers } from "@/utils/discord/stream/bufferManager";

describe("stream boundaries across scripts", () => {
  it("treats a full-width terminator as a boundary without following whitespace", () => {
    const buffer = `${"あ".repeat(50)}。${"い".repeat(50)}`;
    expect(findRegularOverflowFlushIndex(buffer, 40)).toBe(51);
  });

  it("holds the buffer for an unclosed paired quote but never for a surplus closer", () => {
    expect(hasIncompleteSemanticMarkers("Il a dit «Bonjour")).toBe(true);
    expect(hasIncompleteSemanticMarkers("그는 〈안녕")).toBe(true);
    expect(hasIncompleteSemanticMarkers("他说“你好")).toBe(true);
    expect(hasIncompleteSemanticMarkers("「こんにちは")).toBe(true);
    expect(hasIncompleteSemanticMarkers("Il a dit «Bonjour» hier")).toBe(false);
    expect(hasIncompleteSemanticMarkers("stray » closer")).toBe(false);
  });
});
