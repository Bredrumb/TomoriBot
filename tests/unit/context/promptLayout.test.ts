import { describe, expect, it } from "bun:test";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import {
  PROMPT_LAYOUT,
  applyPromptLayoutInserts,
  isPromptSystemItem,
  orderNativePromptBlocks,
  type PromptLayoutInsert,
} from "@/utils/text/context/promptLayout";

function item(metadataTag: ContextItemTag, role: StructuredContextItem["role"] = "user"): StructuredContextItem {
  return { role, metadataTag, parts: [{ type: "text", text: "Fixture" }] };
}

describe("prompt layout registry", () => {
  it("declares every context tag and insert exactly once", () => {
    const tags = PROMPT_LAYOUT.map((entry) => entry.tag);
    expect(new Set(tags).size).toBe(tags.length);
    const contextTags = new Set<string>(Object.values(ContextItemTag));
    expect(
      tags
        .filter((tag) => contextTags.has(tag))
        .map(String)
        .sort(),
    ).toEqual([...contextTags].sort());
  });

  it("routes tagged blocks by zone and retains the declared personal-memory role exception", () => {
    for (const tag of [ContextItemTag.SYSTEM_PERSONALITY, ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE]) {
      expect(isPromptSystemItem(item(tag, "system"))).toBe(true);
    }
    expect(isPromptSystemItem(item(ContextItemTag.KNOWLEDGE_USER_MEMORIES, "system"))).toBe(true);
    expect(isPromptSystemItem(item(ContextItemTag.KNOWLEDGE_USER_MEMORIES, "user"))).toBe(false);
    expect(isPromptSystemItem(item(ContextItemTag.SYSTEM_INSTRUCTION_BLOCK))).toBe(false);
    for (const role of ["user", "model"] as const) {
      expect(isPromptSystemItem(item(ContextItemTag.DIALOGUE_HISTORY, role))).toBe(false);
      expect(isPromptSystemItem(item(ContextItemTag.DIALOGUE_SAMPLE, role))).toBe(false);
    }
    for (const role of ["system", "user", "model"] as const) {
      expect(isPromptSystemItem({ role, parts: [] })).toBe(role === "system");
    }
  });

  it("orders contributed blocks while preserving the history and note sequence", () => {
    const history = item(ContextItemTag.DIALOGUE_HISTORY);
    const note = item(ContextItemTag.CONTEXT_NOTE_INJECTION);
    const latest = item(ContextItemTag.DIALOGUE_HISTORY, "model");
    const documents = item(ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS);
    const prompt = item(ContextItemTag.SYSTEM_PERSONALITY, "system");
    const blocks = [history, documents, note, latest, prompt];
    orderNativePromptBlocks(blocks);
    expect(blocks).toEqual([prompt, documents, history, note, latest]);
  });

  it("applies positional inserts in registry order regardless of caller order", () => {
    const samples = [item(ContextItemTag.DIALOGUE_SAMPLE), item(ContextItemTag.DIALOGUE_SAMPLE, "model")];
    const history = Array.from({ length: 4 }, () => item(ContextItemTag.DIALOGUE_HISTORY));
    const lower = item(ContextItemTag.DIALOGUE_HISTORY);
    const memory = item(ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY);
    const nudge = item(ContextItemTag.CONTEXT_NOTE_INJECTION);
    const tail = item(ContextItemTag.DIALOGUE_HISTORY);
    const queue = item(ContextItemTag.DIALOGUE_HISTORY);
    const uncensor = item(ContextItemTag.DIALOGUE_HISTORY);
    const blocks = [...samples, ...history];
    applyPromptLayoutInserts(blocks, [
      { tag: "uncensor", items: [uncensor] },
      { tag: "queued_reply", items: [queue] },
      { tag: "combined_tail", items: [tail] },
      { tag: "stm_nudge", items: [nudge], depth: 2 },
      { tag: "stm_content", items: [memory], depth: 2 },
      { tag: "lower_priority_tail", items: [lower] },
    ]);
    expect(blocks).toEqual([
      ...samples,
      ...history.slice(0, 2),
      lower,
      memory,
      nudge,
      ...history.slice(2),
      tail,
      queue,
      uncensor,
    ]);
  });

  it("keeps simplified-message notes after the spacer and in registry order at equal depth", () => {
    const spacer = item(ContextItemTag.DIALOGUE_HISTORY);
    const persona = item(ContextItemTag.CONTEXT_NOTE_INJECTION);
    const channel = item(ContextItemTag.CONTEXT_NOTE_INJECTION);
    const verbatim = item(ContextItemTag.CONTEXT_NOTE_INJECTION);
    const reunion = item(ContextItemTag.CONTEXT_NOTE_INJECTION);
    const global = item(ContextItemTag.CONTEXT_NOTE_INJECTION);
    const inserts: PromptLayoutInsert[] = [
      { tag: "reunion_note", items: [reunion] },
      { tag: "verbatim_nudge", items: [verbatim] },
      { tag: "channel_note", items: [channel], depth: 3 },
      { tag: "persona_note", items: [persona], depth: 3 },
      { tag: "global_note", items: [global], depth: 0 },
    ];
    const blocks = [spacer];
    applyPromptLayoutInserts(blocks, inserts, { index: 0, total: 6 });
    expect(blocks).toEqual([spacer]);
    applyPromptLayoutInserts(blocks, inserts, { index: 3, total: 6 });
    expect(blocks).toEqual([spacer, persona, channel, verbatim, reunion]);
    applyPromptLayoutInserts(blocks, inserts, { index: 6, total: 6, flush: true });
    expect(blocks).toEqual([spacer, persona, channel, verbatim, reunion, global]);
  });

  it("clamps emitted-history depths and keeps negative-depth STM inline", () => {
    const sample = item(ContextItemTag.DIALOGUE_SAMPLE);
    const memory = item(ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY);
    const nudge = item(ContextItemTag.CONTEXT_NOTE_INJECTION);
    const history = item(ContextItemTag.DIALOGUE_HISTORY);
    const blocks = [sample, history];
    applyPromptLayoutInserts(blocks, [
      { tag: "stm_content", items: [memory], depth: -1 },
      { tag: "stm_nudge", items: [nudge], depth: 20 },
    ]);
    expect(blocks).toEqual([sample, nudge, history]);
    const empty: StructuredContextItem[] = [];
    applyPromptLayoutInserts(empty, [{ tag: "stm_nudge", items: [nudge], depth: 20 }]);
    expect(empty).toEqual([nudge]);
  });
});
