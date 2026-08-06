import { describe, expect, it } from "bun:test";
import { DuckDuckGoHandler } from "@/tools/mcpServers/duckduckgo-search/duckduckgoHandler";
import type { MCPExecutionContext, MCPServerResponse } from "@/types/tool/mcpTypes";

function createContext(): MCPExecutionContext {
  return {
    locale: "en-US",
    suppressProgressNotices: true,
    executionStartTime: Date.now(),
  } as unknown as MCPExecutionContext;
}

describe("DuckDuckGoHandler", () => {
  it("extracts text from the Gemini MCP function-response envelope", async () => {
    const response: MCPServerResponse = {
      functionResponse: {
        response: {
          content: [{ type: "text", text: "Result\nURL: https://example.com" }],
        },
      },
    };

    const result = await new DuckDuckGoHandler().processResult("web-search", response, createContext(), {
      query: "example",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Result\nURL: https://example.com");
    expect(result.message).not.toContain("functionResponse");
  });

  it("recognizes nested Gemini MCP error envelopes", async () => {
    const response: MCPServerResponse = {
      functionResponse: {
        response: {
          error: {
            isError: true,
            content: [{ type: "text", text: "upstream unavailable" }],
          },
        },
      },
    };

    const result = await new DuckDuckGoHandler().processResult("iask-search", response, createContext(), {
      query: "example",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("upstream unavailable");
  });
});
