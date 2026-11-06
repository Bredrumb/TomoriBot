import { expect, it, spyOn } from "bun:test";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { historyWindowStride } from "@/utils/discord/messageFetchLimit";
import { log } from "@/utils/misc/logger";
import { applyProviderContextTruncation } from "@/utils/provider/contextBudget";
import * as modelLimits from "@/utils/provider/modelLimits";
import { truncateDialogueHistory } from "@/utils/text/contextTruncator";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

function history(count: number): StructuredContextItem[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 ? "model" : "user",
    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
    parts: [{ type: "text", text: String(index).padEnd(40, ".") }],
  }));
}

it("keeps the retained start stable until a stride of exchanges exhausts the budget margin", async () => {
  const limits = spyOn(modelLimits, "resolveModelLimits").mockResolvedValue({
    contextWindow: 1000,
    maxOutputTokens: 100,
  });
  const warning = spyOn(log, "warn").mockImplementation(() => {});
  try {
    for (const limit of [20, 30, 80, 100]) {
      const persona = createPersona({
        llm: createLlmRow({ llm_provider: "openrouter", llm_codename: "margin-fixture" }),
        config: { llm_max_output_tokens: 100, message_fetch_limit: limit },
      });
      const stride = historyWindowStride(limit);
      expect(truncateDialogueHistory(history(80), 1000, 100, [], limit).totalDropped).toBe(0);
      for (let added = 2; added <= stride + 2; added += 2) {
        const items = history(80 + added);
        const snapshot = truncateDialogueHistory(items, 1000, 100, [], limit);
        const live = await applyProviderContextTruncation(items, persona);
        const dropped = added > stride ? stride * 2 : stride;
        expect(snapshot.historyPairsDropped).toBe(dropped / 2);
        expect(snapshot.truncated).toEqual(items.slice(dropped));
        expect(live).toEqual(snapshot.truncated);
        expect(items).toHaveLength(80 + added);
      }
    }
  } finally {
    limits.mockRestore();
    warning.mockRestore();
  }
});

it("preserves fixed context, samples, and the newest request when even all droppable history cannot fit", () => {
  const system: StructuredContextItem = { role: "system", parts: [{ type: "text", text: "x".repeat(4000) }] };
  const sample: StructuredContextItem = { ...system, metadataTag: ContextItemTag.DIALOGUE_SAMPLE };
  const items = [system, sample, ...history(9)];
  const result = truncateDialogueHistory(items, 1000, 100);
  expect(result.truncated).toEqual([system, sample, items.at(-1) as StructuredContextItem]);
  expect(result.historyPairsDropped).toBe(4);
  expect(result.sampleItemsDropped).toBe(0);
});

it("budgets reserved tail content before deciding whether to drop a stride", () => {
  const items = history(80);
  const tail: StructuredContextItem[] = [{ role: "model", parts: [{ type: "text", text: "x".repeat(80) }] }];
  const result = truncateDialogueHistory(items, 1000, 100, tail, 20);
  expect(result.historyPairsDropped).toBe(3);
  expect(result.truncated).toEqual(items.slice(6));
  expect(result.truncated).not.toContain(tail[0]);
});
