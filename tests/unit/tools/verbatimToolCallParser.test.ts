import { describe, expect, it } from "bun:test";
import { VerbatimToolCallParser } from "@/utils/tools/verbatimToolCallParser";

const tools: Array<Record<string, unknown>> = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a media file.",
      parameters: {
        type: "object",
        properties: {
          media_id: { type: "string" },
          filename: { type: "string" },
        },
        required: ["media_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate an image.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          media_id: { type: "string" },
          mode: { type: "string" },
        },
        required: ["prompt", "mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reveal_message_metadata",
      description: "Reveal metadata.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complex_mcp_tool",
      description: "Exercise nested JSON arguments.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          filters: {
            type: "object",
            properties: {
              site: { type: "string" },
            },
          },
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["query", "filters"],
      },
    },
  },
];

function run(chunks: string[]): {
  visible: string;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
} {
  const parser = new VerbatimToolCallParser({ tools, maxBufferChars: 8192 });
  let visible = "";
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  for (const chunk of chunks) {
    const result = parser.feed(chunk);
    visible += result.visibleText;
    if (result.functionCall) {
      calls.push({ name: result.functionCall.name, args: result.functionCall.args ?? {} });
    }
  }

  const flushed = parser.flush();
  visible += flushed.pendingText;
  if (flushed.functionCall) {
    calls.push({ name: flushed.functionCall.name, args: flushed.functionCall.args ?? {} });
  }

  return { visible, calls };
}

describe("VerbatimToolCallParser", () => {
  it("parses a chunk-split inline string shorthand call", () => {
    const { visible, calls } = run(["`read", '_file("media_1")`']);

    expect(visible).toBe("");
    expect(calls).toEqual([{ name: "read_file", args: { media_id: "media_1" } }]);
  });

  it("parses a fenced JSON-object call", () => {
    const { visible, calls } = run([
      '```json\ngenerate_image({"prompt":"portrait","media_id":"media_1","mode":"img2img"})\n```',
    ]);

    expect(visible).toBe("");
    expect(calls).toEqual([
      {
        name: "generate_image",
        args: { prompt: "portrait", media_id: "media_1", mode: "img2img" },
      },
    ]);
  });

  it("parses complex JSON-object args with nested objects and arrays", () => {
    const { visible, calls } = run([
      '`complex_mcp_tool({"query":"cats","filters":{"site":"example.com"},"tags":["cute","gif"]})`',
    ]);

    expect(visible).toBe("");
    expect(calls).toEqual([
      {
        name: "complex_mcp_tool",
        args: {
          query: "cats",
          filters: { site: "example.com" },
          tags: ["cute", "gif"],
        },
      },
    ]);
  });

  it("parses a no-argument call", () => {
    const { visible, calls } = run(["`reveal_message_metadata()`"]);

    expect(visible).toBe("");
    expect(calls).toEqual([{ name: "reveal_message_metadata", args: {} }]);
  });

  it("rejects unknown tools and emits the text", () => {
    const text = '`unknown_tool({"x":1})`';
    const { visible, calls } = run([text]);

    expect(visible).toBe(text);
    expect(calls).toHaveLength(0);
  });

  it("rejects string shorthand for multi-required-argument tools", () => {
    const text = '`generate_image("portrait")`';
    const { visible, calls } = run([text]);

    expect(visible).toBe(text);
    expect(calls).toHaveLength(0);
  });

  it("does not parse calls after visible prose", () => {
    const text = 'I should use a tool: `read_file("media_1")`';
    const { visible, calls } = run([text]);

    expect(visible).toBe(text);
    expect(calls).toHaveLength(0);
  });

  it("flushes incomplete held text as visible text", () => {
    const text = '`read_file("media_1")';
    const { visible, calls } = run([text]);

    expect(visible).toBe(text);
    expect(calls).toHaveLength(0);
  });
});
