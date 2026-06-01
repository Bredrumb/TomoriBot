import { describe, expect, it } from "bun:test";
import { createDefaultStreamState } from "@/types/stream/types";
import { drainThinkBlocksFromBuffer, hasIncompleteSemanticMarkers } from "@/utils/discord/stream/bufferManager";

describe("stream buffer think-block fallback", () => {
  it("routes text before a stray close tag into raw thoughts", () => {
    const state = createDefaultStreamState();
    state.buffer = "originally.</think>Bella: Eep!";

    drainThinkBlocksFromBuffer(state);

    expect(state.thoughtRawSegments).toEqual(["originally."]);
    expect(state.buffer).toBe("Bella: Eep!");
  });

  it("holds a partial close tag so a reasoning tail cannot flush visibly", () => {
    expect(hasIncompleteSemanticMarkers("originally.</thi")).toBe(true);
  });
});
