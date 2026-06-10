import { describe, expect, it } from "bun:test";
import { GemmaToolCallParser } from "@/providers/custom/customGemmaToolParser";

/**
 * Drives a parser with a list of chunks and collects every function call and all
 * visible text emitted across feed() plus the final flush(). Mirrors how
 * CustomStreamAdapter.processChunk consumes the parser chunk-by-chunk.
 */
function run(chunks: string[]): {
  visible: string;
  calls: { name: string; args: Record<string, unknown> }[];
} {
  const parser = new GemmaToolCallParser();
  let visible = "";
  const calls: { name: string; args: Record<string, unknown> }[] = [];

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

describe("GemmaToolCallParser — special-token dialect (<|tool_call>)", () => {
  it("parses a complete special-token call and emits no visible text", () => {
    const { visible, calls } = run([
      '<|tool_call>call:update_short_term_memory{summary:<|"|>They had tea.<|"|>}<tool_call|>',
    ]);
    expect(visible).toBe("");
    expect(calls).toEqual([{ name: "update_short_term_memory", args: { summary: "They had tea." } }]);
  });

  it("passes normal prose through unchanged", () => {
    const { visible, calls } = run(["Hello there, ", "how are you?"]);
    expect(visible).toBe("Hello there, how are you?");
    expect(calls).toHaveLength(0);
  });
});

describe("GemmaToolCallParser — tool_code dialect (<tool_code>)", () => {
  it("parses a complete Python-call block and emits no visible text", () => {
    const { visible, calls } = run([
      '<tool_code>update_short_term_memory(summary="Nerine and Pali had tea.")</tool_code>',
    ]);
    expect(visible).toBe("");
    expect(calls).toEqual([{ name: "update_short_term_memory", args: { summary: "Nerine and Pali had tea." } }]);
  });

  it("keeps text before the block visible, and resumes visible text in a later chunk", () => {
    // A completed call ends the turn for the pipeline (the adapter drops same-chunk
    // trailing content), but the parser returns to idle so a *subsequent* chunk's
    // prose is emitted normally.
    const { visible, calls } = run(['Sure!<tool_code>note(text="hi")</tool_code>', "Done."]);
    expect(visible).toBe("Sure!Done.");
    expect(calls).toEqual([{ name: "note", args: { text: "hi" } }]);
  });

  it("handles a block split across chunk boundaries", () => {
    const { visible, calls } = run([
      "<tool_co",
      'de>update_short_term_memory(summary="split val',
      'ue")</tool_',
      "code>",
    ]);
    expect(visible).toBe("");
    expect(calls).toEqual([{ name: "update_short_term_memory", args: { summary: "split value" } }]);
  });

  it("parses mixed scalar and string args, including single quotes", () => {
    const { visible, calls } = run([
      "<tool_code>set_state(count=3, enabled=true, ratio=1.5, label='alpha')</tool_code>",
    ]);
    expect(visible).toBe("");
    expect(calls).toEqual([{ name: "set_state", args: { count: 3, enabled: true, ratio: 1.5, label: "alpha" } }]);
  });

  it("unwraps a print(...) wrapper", () => {
    const { calls } = run(['<tool_code>print(note(text="wrapped"))</tool_code>']);
    expect(calls).toEqual([{ name: "note", args: { text: "wrapped" } }]);
  });

  it("recovers a truncated block at stream end (missing close tag)", () => {
    const { calls } = run(['<tool_code>note(text="never closed"']);
    expect(calls).toEqual([{ name: "note", args: { text: "never closed" } }]);
  });

  it("does not misread a quoted value containing '=' as a scalar arg", () => {
    const { calls } = run(['<tool_code>note(text="a=b", flag=false)</tool_code>']);
    expect(calls).toEqual([{ name: "note", args: { text: "a=b", flag: false } }]);
  });
});

describe("GemmaToolCallParser — dialect coexistence", () => {
  it("recognises whichever dialect appears first in a chunk", () => {
    const special = run(['<|tool_call>call:a{x:<|"|>1<|"|>}<tool_call|>']);
    const pythonic = run(['<tool_code>b(x="1")</tool_code>']);

    expect(special.calls).toEqual([{ name: "a", args: { x: "1" } }]);
    expect(pythonic.calls).toEqual([{ name: "b", args: { x: "1" } }]);
  });
});
