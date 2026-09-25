import { describe, expect, it } from "bun:test";
import type { LlmRow, TomoriState } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import { resolveFallbackSlot } from "@/utils/discord/fallbackModelNotice";

function makeLlm(id: number, codename: string): LlmRow {
  return { llm_id: id, llm_codename: codename, llm_provider: "google" } as unknown as LlmRow;
}

function makeContext(fallbackModels: LlmRow[]): ToolContext {
  return {
    tomoriState: {
      server_id: 1,
      fallback_chain: fallbackModels.map((model) => ({ kind: "llm" as const, model })),
    } as unknown as TomoriState,
  } as unknown as ToolContext;
}

describe("fallback receipt slot", () => {
  it("names the configured slot of a fallback that answered", () => {
    const [first, second] = [makeLlm(2, "fallback-a"), makeLlm(3, "fallback-b")];

    expect(resolveFallbackSlot(makeContext([first, second]), second)).toBe(2);
  });

  it("names the route's lead rather than a slot for a model outside the fallback list", () => {
    // The server route answers with its own lead after the personal route failed. It holds no slot
    // in the server's fallback list, and reporting the failure count here named a slot the reader
    // could not find in the receipt.
    const context = makeContext([makeLlm(2, "server-fallback")]);

    expect(resolveFallbackSlot(context, makeLlm(1, "server-primary"))).toBe(1);
  });

  it("still names a configured slot when several attempts failed before it", () => {
    const context = makeContext([makeLlm(2, "server-fallback")]);

    expect(resolveFallbackSlot(context, makeLlm(2, "server-fallback"))).toBe(1);
  });
});
