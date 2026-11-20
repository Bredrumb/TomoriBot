import { describe, expect, it } from "bun:test";
import { resolveOpenCodeSessionId } from "@/providers/custom/customStreamAdapter";

const CHANNEL = "1412345678901234567";
const conversation = { channelId: CHANNEL, personaId: 7 };

describe("OpenCode session header", () => {
  it("is sent to OpenCode Go and Zen only", () => {
    expect(resolveOpenCodeSessionId("https://opencode.ai/zen/go/v1", conversation)).not.toBeNull();
    expect(resolveOpenCodeSessionId("https://opencode.ai/zen/v1", conversation)).not.toBeNull();

    for (const url of [
      "https://opencode.ai/",
      "https://opencode.ai/docs/zen/",
      "https://api.openai.com/v1",
      "https://opencode.ai.example.com/zen/v1",
      "not a url",
    ]) {
      expect(resolveOpenCodeSessionId(url, conversation)).toBeNull();
    }
  });

  it("stays stable within a conversation and never carries the channel snowflake", () => {
    const url = "https://opencode.ai/zen/go/v1";
    const first = resolveOpenCodeSessionId(url, conversation);

    expect(resolveOpenCodeSessionId(url, { ...conversation })).toBe(first);
    expect(resolveOpenCodeSessionId(url, { channelId: "1412345678901234568", personaId: 7 })).not.toBe(first);
    expect(resolveOpenCodeSessionId(url, { channelId: CHANNEL, personaId: 8 })).not.toBe(first);
    expect(first).not.toContain(CHANNEL);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
  });
});
