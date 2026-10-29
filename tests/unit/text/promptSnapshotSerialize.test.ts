import { describe, expect, test } from "bun:test";
import type { StructuredContextItem } from "@/types/misc/context";
import { buildJsonSnapshot, buildRequestConfig, buildTextSnapshot } from "@/utils/text/promptInspection/serialize";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

const items: StructuredContextItem[] = [
  { role: "system", parts: [{ type: "text", text: "You are Mirri." }] },
  { role: "user", parts: [{ type: "text", text: "hello" }] },
];

describe("prompt snapshot request config placement", () => {
  test("text snapshot opens with the config under a not-part-of-the-prompt header", () => {
    const text = buildTextSnapshot(items, { temperature: 0.5 });
    const configAt = text.indexOf('"temperature": 0.5');
    expect(text.startsWith("=== Request Config")).toBe(true);
    expect(configAt).toBeGreaterThan(-1);
    expect(configAt).toBeLessThan(text.indexOf("You are Mirri."));
  });

  test("json snapshot lists model and config keys before the message list, with tools last", async () => {
    const persona = createPersona({ llm: createLlmRow({ llm_provider: "openrouter" }) });
    const config = buildRequestConfig(persona, "openrouter", "some/model", 1024);
    const snapshot = await buildJsonSnapshot(items, persona, "openrouter", "some/model", [{ name: "tool" }], config);

    const keys = Object.keys(snapshot);
    expect(keys[0]).toBe("model");
    expect(keys.indexOf("max_tokens")).toBeLessThan(keys.indexOf("messages"));
    expect(keys.at(-1)).toBe("tools");
  });
});
