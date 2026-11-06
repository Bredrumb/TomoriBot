import { describe, expect, it } from "bun:test";
import { humanizerSettingsFromDegree } from "@/constants/humanizer";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { appendDialogueHistoryContext } from "@/utils/text/context/dialogueHistory";
import { buildSampleDialogueContextItems } from "@/utils/text/context/templates";
import { UNPAIRED_SAMPLE_DIALOGUE_SENTINEL } from "@/types/preset/presetExport";
import { createPersona } from "../../helpers/fixtures";
import { createParticipantContextFixture } from "./fixtures/participantContextFixture";
import {
  PROMPT_LAYOUT,
  applyPromptLayoutInserts,
  isPromptSystemItem,
  orderNativePromptBlocks,
  type PromptLayoutInsert,
  type PromptLayoutItem,
  STM_TAIL_SLOT,
  CACHEABLE_PREFIX_END,
  getCacheablePrefixBoundary,
  speakerTurnStartIndexes,
  TAIL_SLOT_SPEAKER_TURNS,
} from "@/utils/text/context/promptLayout";

function item(metadataTag: ContextItemTag, role: StructuredContextItem["role"] = "user"): StructuredContextItem {
  return { role, metadataTag, parts: [{ type: "text", text: "Fixture" }] };
}

function dialogue(name: string, type: "user" | "persona" = "user"): StructuredContextItem {
  return {
    ...item(ContextItemTag.DIALOGUE_HISTORY, type === "persona" ? "model" : "user"),
    sender: { id: name, name, type },
  };
}

function freshMemory(): PromptLayoutItem {
  return { ...item(ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY), [STM_TAIL_SLOT]: true };
}

describe("prompt layout registry", () => {
  it("counts author identities across renamed profiles while ignoring synthetic notices", async () => {
    const fixture = createParticipantContextFixture();
    const persona = createPersona({ config: { ...humanizerSettingsFromDegree(0), context_note: null } });
    try {
      const messages = [
        { id: "1", authorId: "first-user", authorName: "Juno" },
        { id: "2", authorId: "second-user", authorName: "Juno" },
        { id: "agenda", authorId: "synthetic-nudge-agenda", authorName: "System", isSystemNotice: true },
        { id: "3", authorId: "second-user", authorName: "Bau" },
        { id: "4", authorId: "third-user", authorName: "System" },
        { id: "5", authorId: "first-user", authorName: "Juno" },
        { id: "6", authorId: "second-user", authorName: "Bau" },
      ];
      const blocks: StructuredContextItem[] = [];
      await appendDialogueHistoryContext({
        contextItems: blocks,
        client: fixture.client,
        guildId: "fixture-guild",
        simplifiedMessageHistory: messages.map((message) => ({
          ...message,
          authorType: "user",
          content: message.id,
          imageAttachments: [],
          videoAttachments: [],
        })),
        botName: persona.persona_nickname,
        tomoriConfig: persona.config,
        tomoriState: persona,
        documentHintTemplate: "",
        includeTimestamps: false,
        isUserImpersonation: false,
        triggererFormattedName: "Juno",
        uncensorInputOptions: { unicodeSpacesEnabled: false, sanitizeEnabled: false },
        convertMentions: async (text) => text,
      });
      expect(speakerTurnStartIndexes(blocks).map((index) => blocks[index].messageId)).toEqual([
        "1",
        "2",
        "4",
        "5",
        "6",
      ]);
      expect(blocks.find((block) => block.messageId === "agenda")?.sender).toBeUndefined();
      applyPromptLayoutInserts(blocks, []);
      expect(getCacheablePrefixBoundary(blocks)?.messageId).toBe("1");
    } finally {
      fixture.restoreRepositories();
    }
  });

  it("counts speaker changes across media splits and day spacers while ignoring directives and notes", () => {
    const media = dialogue("Juno");
    media.mediaDescriptors = [
      {
        kind: "image",
        uri: "https://example.com/image.png",
        mimeType: "image/png",
        mediaId: "media_1",
        withinWindow: true,
      },
    ];
    const blocks = [
      dialogue("Juno"),
      media,
      item(ContextItemTag.DIALOGUE_HISTORY),
      dialogue("Juno"),
      item(ContextItemTag.CONTEXT_NOTE_INJECTION),
      dialogue("Mirri", "persona"),
      item(ContextItemTag.DIALOGUE_HISTORY),
      dialogue("Mirri", "persona"),
      dialogue("Mirri"),
    ];
    expect(speakerTurnStartIndexes(blocks)).toEqual([0, 5, 8]);
  });

  it("places the slot above four complete speaker turns and keeps shallow notes below it", () => {
    const history = [
      dialogue("Juno"),
      dialogue("Mirri", "persona"),
      dialogue("Juno"),
      dialogue("Juno"),
      dialogue("Mirri", "persona"),
      dialogue("Juno"),
      dialogue("Mirri", "persona"),
    ];
    const note = item(ContextItemTag.CONTEXT_NOTE_INJECTION);
    const spacer = item(ContextItemTag.DIALOGUE_HISTORY);
    const memory = freshMemory();
    const blocks = [...history.slice(0, 2), spacer, note, ...history.slice(2)];
    applyPromptLayoutInserts(blocks, [{ tag: "stm_content", items: [memory], depth: -1 }]);
    expect(blocks.indexOf(memory)).toBe(2);
    expect(blocks.slice(3)).toEqual([spacer, note, ...history.slice(2)]);
    expect(getCacheablePrefixBoundary(blocks)).toBe(blocks[1]);
  });

  it("extracts volatile blocks into registry order while constant lore remains above history", () => {
    const constant = item(ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE, "system");
    const history = Array.from({ length: 8 }, (_, index) => dialogue(index % 2 ? "Mirri" : "Juno"));
    const memory = freshMemory();
    const loreBefore = item(ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE);
    const loreAfter = item(ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER);
    const documents = item(ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS);
    const status = item(ContextItemTag.KNOWLEDGE_USER_STATUS);
    const current = item(ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT);
    const blocks = [constant, current, documents, ...history, status, loreAfter, loreBefore];
    applyPromptLayoutInserts(blocks, [{ tag: "stm_content", items: [memory], depth: -1 }]);
    expect(blocks[0]).toBe(constant);
    expect(blocks.slice(5, 11)).toEqual([memory, loreBefore, loreAfter, documents, status, current]);
    expect(getCacheablePrefixBoundary(blocks)).toBe(blocks[4]);
  });

  it("continues speaker runs into directly preceding samples", () => {
    const prefix = item(ContextItemTag.SYSTEM_PERSONALITY, "system");
    const samples = Array.from({ length: 4 }, (_, index) =>
      item(ContextItemTag.DIALOGUE_SAMPLE, index % 2 ? "model" : "user"),
    );
    const history = [dialogue("Juno"), dialogue("Mirri", "persona")];
    const memory = freshMemory();
    const blocks = [prefix, ...samples, item(ContextItemTag.DIALOGUE_HISTORY), ...history];
    applyPromptLayoutInserts(blocks, [{ tag: "stm_content", items: [memory] }]);
    expect(blocks.indexOf(memory)).toBe(3);
    expect(blocks.slice(4)).toEqual([...samples.slice(2), item(ContextItemTag.DIALOGUE_HISTORY), ...history]);
  });

  it("keeps consecutive unpaired persona samples in one run, including a following persona message", async () => {
    const fixture = createParticipantContextFixture();
    const persona = createPersona({
      persona_nickname: "Mirri",
      sample_dialogues_in: Array(4).fill(UNPAIRED_SAMPLE_DIALOGUE_SENTINEL),
      sample_dialogues_out: Array.from({ length: 4 }, (_, index) => String(index)),
      config: humanizerSettingsFromDegree(0),
    });
    try {
      const samples = await buildSampleDialogueContextItems({
        client: fixture.client,
        guildId: "fixture-guild",
        triggererName: "Juno",
        botName: persona.persona_nickname,
        tomoriState: persona,
        tomoriConfig: persona.config,
        isUserImpersonation: false,
        uncensorInputOptions: { unicodeSpacesEnabled: false, sanitizeEnabled: false },
        convertMentions: async (text) => text,
      });
      for (const history of [[dialogue("Juno")], [dialogue("Mirri", "persona"), dialogue("Juno")]]) {
        const prefix = item(ContextItemTag.SYSTEM_PERSONALITY, "system");
        const blocks = [prefix, ...samples, ...history];
        const memory = freshMemory();
        applyPromptLayoutInserts(blocks, [{ tag: "stm_content", items: [memory] }]);
        expect(blocks.indexOf(memory)).toBe(1);
        expect(getCacheablePrefixBoundary(blocks)).toBe(blocks[0]);
      }
    } finally {
      fixture.restoreRepositories();
    }
  });

  it("clamps the slot above the earliest counted item when history and adjacent samples are short", () => {
    for (const samples of [[], [item(ContextItemTag.DIALOGUE_SAMPLE, "model")]]) {
      const blocks = [item(ContextItemTag.SYSTEM_PERSONALITY, "system"), ...samples, dialogue("Juno")];
      const memory = freshMemory();
      applyPromptLayoutInserts(blocks, [{ tag: "stm_content", items: [memory] }]);
      expect(blocks.indexOf(memory)).toBe(1);
    }
  });

  it("does not count preset samples separated from history or placed at the end", () => {
    const sample = item(ContextItemTag.DIALOGUE_SAMPLE, "model");
    const separator: StructuredContextItem = { role: "user", parts: [{ type: "text", text: "Preset block" }] };
    const history = dialogue("Juno");
    for (const blocks of [
      [sample, separator, history],
      [history, sample, separator],
    ]) {
      const memory = freshMemory();
      applyPromptLayoutInserts(blocks, [{ tag: "stm_content", items: [memory] }]);
      expect(blocks.indexOf(memory)).toBe(blocks.indexOf(history) - 1);
    }
  });

  it("uses terminal samples only when no intervening preset block separates them from empty history", () => {
    const sample = item(ContextItemTag.DIALOGUE_SAMPLE, "model");
    const separator: StructuredContextItem = { role: "user", parts: [{ type: "text", text: "Preset block" }] };
    for (const suffix of [[], [separator]]) {
      const memory = freshMemory();
      const blocks = [sample, ...suffix];
      applyPromptLayoutInserts(blocks, [{ tag: "stm_content", items: [memory] }]);
      expect(blocks.indexOf(memory)).toBe(suffix.length === 0 ? 0 : 2);
    }
  });

  it("marks the same cacheable-prefix item with an empty or occupied slot and preserves the data through item spreads", () => {
    const source = [
      item(ContextItemTag.SYSTEM_PERSONALITY, "system"),
      ...Array.from({ length: 6 }, (_, index) => dialogue(index % 2 ? "Mirri" : "Juno")),
    ];
    const empty = [...source];
    const occupied = [...source];
    applyPromptLayoutInserts(empty, []);
    applyPromptLayoutInserts(occupied, [{ tag: "stm_content", items: [freshMemory()] }]);
    for (const blocks of [empty, occupied]) {
      expect(getCacheablePrefixBoundary(blocks)).toBe(blocks[2]);
      const copied = blocks.map((item) => ({ ...item }));
      expect(getCacheablePrefixBoundary(copied)).toBe(copied[2]);
      expect(JSON.stringify(blocks[2])).toBe(JSON.stringify(source[2]));
    }
    expect(getCacheablePrefixBoundary(source)).toBeUndefined();
    const noPrefix = [dialogue("Juno")];
    applyPromptLayoutInserts(noPrefix, []);
    expect(getCacheablePrefixBoundary(noPrefix)).toBeUndefined();
  });

  it("keeps a saved item depth when it resolves closer to the end than the speaker-turn slot", () => {
    for (const depth of [0, 1, 3, 20]) {
      const blocks = Array.from({ length: 6 }, (_, index) => dialogue(index % 2 ? "Mirri" : "Juno"));
      const memory = freshMemory();
      applyPromptLayoutInserts(blocks, [{ tag: "stm_content", items: [memory], depth }]);
      expect(blocks.indexOf(memory)).toBe(Math.max(2, 6 - depth));
      expect(getCacheablePrefixBoundary(blocks)).toBe(blocks[1]);
    }
  });

  it("declares every context tag with non-overlapping role variants", () => {
    const tags = PROMPT_LAYOUT.map((entry) => entry.tag);
    const variants = PROMPT_LAYOUT.flatMap((entry) =>
      (entry.role ? [entry.role] : ["system", "user", "model"]).map((role) => `${entry.tag}:${role}`),
    );
    expect(new Set(variants).size).toBe(variants.length);
    const contextTags = new Set<string>(Object.values(ContextItemTag));
    expect(
      [...new Set(tags)]
        .filter((tag) => contextTags.has(tag))
        .map(String)
        .sort(),
    ).toEqual([...contextTags].sort());
  });

  it("keeps volatility increasing above the tail and confines volatile contributions to tail anchors", () => {
    const violations: string[] = [];
    const rank = { static: 0, slow: 1, turn: 2, clock: 3 };
    let previous = 0;
    for (const entry of PROMPT_LAYOUT) {
      const label = `${entry.tag}${entry.role ? `:${entry.role}` : ""}`;
      if (entry.zone !== "tail" && (entry.anchor.kind === "block" || entry.anchor.kind === "history")) {
        if (rank[entry.volatility] < previous) violations.push(`${label}: volatility decreases`);
        previous = rank[entry.volatility];
        if (entry.anchor.kind === "block" && rank[entry.volatility] >= rank.turn)
          violations.push(`${label}: volatile block above tail slot`);
      }
      if (entry.zone !== "tail" && entry.anchor.kind !== "history" && rank[entry.volatility] >= rank.turn) {
        if (
          entry.anchor.kind !== "simplified-message" ||
          typeof entry.anchor.depth !== "number" ||
          entry.anchor.depth > TAIL_SLOT_SPEAKER_TURNS
        )
          violations.push(`${label}: volatile insert can precede tail slot`);
      }
    }
    expect(violations).toEqual([]);
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
    expect(blocks).toEqual([prompt, history, note, latest, documents]);
  });

  it("applies positional inserts in registry order regardless of caller order", () => {
    const samples = [item(ContextItemTag.DIALOGUE_SAMPLE), item(ContextItemTag.DIALOGUE_SAMPLE, "model")];
    const history = Array.from({ length: 4 }, (_, index) => dialogue(index % 2 ? "Mirri" : "Juno"));
    const lower = item(ContextItemTag.DIALOGUE_HISTORY);
    const memory = item(ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY);
    const nudge = { ...item(ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY), completionText: "" };
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
    const markedSample: PromptLayoutItem = { ...samples[1], [CACHEABLE_PREFIX_END]: true };
    expect(blocks).toEqual([
      samples[0],
      markedSample,
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
    const nudge = { ...item(ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY), completionText: "" };
    const history = dialogue("Juno");
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
