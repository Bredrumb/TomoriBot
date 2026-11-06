import { expect, it, spyOn } from "bun:test";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { historyWindowStride } from "@/utils/discord/messageFetchLimit";
import { log } from "@/utils/misc/logger";
import { applyProviderContextTruncation } from "@/utils/provider/contextBudget";
import * as modelLimits from "@/utils/provider/modelLimits";
import { truncateDialogueHistory } from "@/utils/text/contextTruncator";
import {
  applyPromptLayoutInserts,
  getCacheablePrefixBoundary,
  STM_TAIL_SLOT,
  type PromptLayoutItem,
} from "@/utils/text/context/promptLayout";
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

it("retains tail-slot facts across removed exchanges and repositions them above surviving samples", () => {
  for (const depth of [-1, 0, 1, 20]) {
    const fixed: StructuredContextItem = {
      role: "system",
      metadataTag: ContextItemTag.SYSTEM_PERSONALITY,
      parts: [{ type: "text", text: "s".repeat(100) }],
    };
    const samples: StructuredContextItem[] = (["user", "model"] as const).map((role) => ({
      role,
      metadataTag: ContextItemTag.DIALOGUE_SAMPLE,
      parts: [{ type: "text", text: role }],
    }));
    const dialogue = history(11).map((item, index) => ({
      ...item,
      messageId: String(index),
      sender: {
        id: index % 2 ? "persona" : "user",
        name: index % 2 ? "Mirri" : "Juno",
        type: index % 2 ? ("persona" as const) : ("user" as const),
      },
      parts: [{ type: "text" as const, text: "h".repeat(1000) }],
    }));
    const facts: StructuredContextItem[] = [
      ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
      ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
      ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
      ContextItemTag.KNOWLEDGE_USER_STATUS,
      ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT,
    ].map((metadataTag) => ({ role: "user", metadataTag, parts: [{ type: "text", text: "f".repeat(100) }] }));
    const memory: PromptLayoutItem = {
      role: "user",
      metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
      parts: [{ type: "text", text: "m".repeat(100) }],
      [STM_TAIL_SLOT]: true,
    };
    const items = [fixed, ...samples, ...dialogue, ...facts];
    const directive = (text: string): StructuredContextItem => ({
      role: "user",
      metadataTag: ContextItemTag.DIALOGUE_HISTORY,
      parts: [{ type: "text", text }],
    });
    const lower = directive("lower");
    const nudge: PromptLayoutItem = { ...memory, [STM_TAIL_SLOT]: undefined, completionText: "" };
    const generationTail = [directive("combined"), directive("queued"), directive("uncensor")];
    applyPromptLayoutInserts(items, [
      { tag: "lower_priority_tail", items: [lower] },
      { tag: "stm_content", items: [memory], depth },
      { tag: "stm_nudge", items: [nudge], depth: 1 },
      { tag: "combined_tail", items: [generationTail[0]] },
      { tag: "queued_reply", items: [generationTail[1]] },
      { tag: "uncensor", items: [generationTail[2]] },
    ]);
    const originalBoundary = getCacheablePrefixBoundary(items);
    const result = truncateDialogueHistory(items, 1000, 100, [], 20);
    expect(
      result.truncated.filter((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && item.sender),
    ).toEqual([dialogue.at(-1) as StructuredContextItem]);
    expect(result.truncated.filter((item) => facts.some((fact) => fact.metadataTag === item.metadataTag))).toEqual(
      facts,
    );
    expect(result.truncated).toContain(memory);
    expect(result.truncated.indexOf(facts[0])).toBe(1 + (depth === -1 ? 1 : 0));
    if (depth === 0) expect(result.truncated.indexOf(memory)).toBe(result.truncated.length - generationTail.length - 1);
    else if (depth === -1) expect(result.truncated.indexOf(memory)).toBe(1);
    else expect(result.truncated.indexOf(memory)).toBeLessThan(result.truncated.indexOf(dialogue[10]));
    expect(result.truncated.slice(-generationTail.length)).toEqual(generationTail);
    expect(result.truncated).toContain(lower);
    expect(result.truncated).toContain(nudge);
    expect(getCacheablePrefixBoundary(result.truncated)?.metadataTag).toBe(ContextItemTag.SYSTEM_PERSONALITY);
    expect(getCacheablePrefixBoundary(items)).toBe(originalBoundary);
  }
});
