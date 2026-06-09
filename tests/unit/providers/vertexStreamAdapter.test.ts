import { describe, expect, it } from "bun:test";
import { VertexStreamAdapter } from "@/providers/vertex/vertexStreamAdapter";
import type { RawStreamChunk } from "@/types/stream/interfaces";

function makeVertexChunk(data: Record<string, unknown>): RawStreamChunk {
  return { data, provider: "vertex", metadata: { timestamp: Date.now() } };
}

describe("VertexStreamAdapter.processChunk", () => {
  it("captures candidate thought parts as raw thoughts and emits no visible text", () => {
    const adapter = new VertexStreamAdapter();
    const result = adapter.processChunk(
      makeVertexChunk({
        candidates: [
          {
            content: {
              parts: [{ text: "internal reasoning step", thought: true }],
            },
          },
        ],
      }),
    );

    expect(result.type).toBe("text");
    expect(result.content).toBe("");
    expect(result.thoughts?.[0]).toMatchObject({ kind: "raw", content: "internal reasoning step" });
  });

  it("keeps candidate thought parts separate from visible candidate text", () => {
    const adapter = new VertexStreamAdapter();
    const result = adapter.processChunk(
      makeVertexChunk({
        candidates: [
          {
            content: {
              parts: [{ text: "hidden thought", thought: true }, { text: "Visible reply." }],
            },
          },
        ],
      }),
    );

    expect(result.type).toBe("text");
    expect(result.content).toBe("Visible reply.");
    expect(result.content).not.toContain("hidden thought");
    expect(result.thoughts?.[0]).toMatchObject({ kind: "raw", content: "hidden thought" });
  });
});
