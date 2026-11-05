import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { VERBATIM_TOOL_CALLING_CONTEXT_DEPTH } from "@/utils/tools/verbatimToolCalling";
import { TIME_AWARENESS_NOTE_DEPTH } from "@/utils/text/context/timeAwareness";

/** Zones identify system-message content, user reference blocks before history, conversation history, and positional tail guidance. */
export type PromptZone = "system" | "reference" | "history" | "tail";

/** Volatility identifies config-only edits (static), memory or asset writes (slow), per-turn selection (turn), and wall-time or presence changes (clock). */
export type PromptVolatility = "static" | "slow" | "turn" | "clock";

/** Simplified-message anchors run after that message's date spacer, while dialogue-depth anchors count emitted history items from the end. */
export type PromptAnchor =
  | { kind: "block" | "history" | "before-latest-pair" | "append" }
  | { kind: "simplified-message"; depth: number | "configured" }
  | { kind: "dialogue-depth" };

export type PromptInsertTag =
  | "persona_note"
  | "channel_note"
  | "global_note"
  | "verbatim_nudge"
  | "reunion_note"
  | "lower_priority_tail"
  | "stm_content"
  | "stm_nudge"
  | "combined_tail"
  | "queued_reply"
  | "uncensor";

export interface PromptLayoutEntry {
  tag: ContextItemTag | PromptInsertTag;
  zone: PromptZone;
  volatility: PromptVolatility;
  anchor: PromptAnchor;
  presetFlush?: "knowledge" | "dialogue";
  novelai?: "personality" | "memory" | "sample" | "history";
  roleZones?: Partial<Record<StructuredContextItem["role"], PromptZone>>;
}

export const PROMPT_LAYOUT: readonly PromptLayoutEntry[] = [
  { tag: ContextItemTag.SYSTEM_HUMANIZER_RULES, zone: "system", volatility: "static", anchor: { kind: "block" } },
  { tag: ContextItemTag.SYSTEM_CHANNEL_PROMPT, zone: "system", volatility: "static", anchor: { kind: "block" } },
  { tag: ContextItemTag.SYSTEM_PERSONA_PROMPT, zone: "system", volatility: "static", anchor: { kind: "block" } },
  {
    tag: ContextItemTag.SYSTEM_PERSONALITY,
    zone: "system",
    volatility: "static",
    anchor: { kind: "block" },
    novelai: "personality",
  },
  { tag: ContextItemTag.SYSTEM_FUNCTION_GUIDE, zone: "system", volatility: "static", anchor: { kind: "block" } },
  {
    tag: ContextItemTag.KNOWLEDGE_SERVER_INFO,
    zone: "system",
    volatility: "static",
    anchor: { kind: "block" },
    presetFlush: "knowledge",
  },
  { tag: ContextItemTag.KNOWLEDGE_PERSONA_USER_BLOCKS, zone: "system", volatility: "clock", anchor: { kind: "block" } },
  {
    tag: ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
    zone: "system",
    volatility: "slow",
    anchor: { kind: "block" },
    presetFlush: "knowledge",
    novelai: "memory",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_SERVER_EMOJIS,
    zone: "system",
    volatility: "slow",
    anchor: { kind: "block" },
    presetFlush: "knowledge",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_SERVER_STICKERS,
    zone: "system",
    volatility: "slow",
    anchor: { kind: "block" },
    presetFlush: "knowledge",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_PERSONA_SPRITES,
    zone: "system",
    volatility: "slow",
    anchor: { kind: "block" },
    presetFlush: "knowledge",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
    zone: "reference",
    volatility: "clock",
    anchor: { kind: "block" },
    presetFlush: "dialogue",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_USER_MEMORIES,
    zone: "system",
    roleZones: { user: "reference" },
    volatility: "turn",
    anchor: { kind: "block" },
    novelai: "memory",
  },
  { tag: ContextItemTag.KNOWLEDGE_USER_STATUS, zone: "reference", volatility: "clock", anchor: { kind: "block" } },
  { tag: ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT, zone: "reference", volatility: "clock", anchor: { kind: "block" } },
  {
    tag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
    zone: "reference",
    volatility: "clock",
    anchor: { kind: "block" },
    presetFlush: "dialogue",
    novelai: "memory",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS,
    zone: "reference",
    volatility: "turn",
    anchor: { kind: "block" },
  },
  { tag: ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS, zone: "reference", volatility: "turn", anchor: { kind: "block" } },
  { tag: ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE, zone: "system", volatility: "turn", anchor: { kind: "block" } },
  { tag: ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER, zone: "system", volatility: "turn", anchor: { kind: "block" } },
  {
    tag: ContextItemTag.KNOWLEDGE_SERVER_CONDITIONING,
    zone: "system",
    volatility: "slow",
    anchor: { kind: "block" },
    presetFlush: "dialogue",
  },
  {
    tag: ContextItemTag.DIALOGUE_SAMPLE,
    zone: "history",
    volatility: "turn",
    anchor: { kind: "block" },
    novelai: "sample",
  },
  {
    tag: ContextItemTag.DIALOGUE_HISTORY,
    zone: "history",
    volatility: "turn",
    anchor: { kind: "history" },
    novelai: "history",
  },
  { tag: ContextItemTag.CONTEXT_NOTE_INJECTION, zone: "history", volatility: "turn", anchor: { kind: "history" } },
  {
    tag: "persona_note",
    zone: "history",
    volatility: "static",
    anchor: { kind: "simplified-message", depth: "configured" },
  },
  {
    tag: "channel_note",
    zone: "history",
    volatility: "static",
    anchor: { kind: "simplified-message", depth: "configured" },
  },
  {
    tag: "global_note",
    zone: "history",
    volatility: "static",
    anchor: { kind: "simplified-message", depth: "configured" },
  },
  {
    tag: "verbatim_nudge",
    zone: "history",
    volatility: "static",
    anchor: { kind: "simplified-message", depth: VERBATIM_TOOL_CALLING_CONTEXT_DEPTH },
  },
  {
    tag: "reunion_note",
    zone: "history",
    volatility: "clock",
    anchor: { kind: "simplified-message", depth: TIME_AWARENESS_NOTE_DEPTH },
  },
  { tag: ContextItemTag.SYSTEM_INSTRUCTION_BLOCK, zone: "tail", volatility: "turn", anchor: { kind: "append" } },
  { tag: "lower_priority_tail", zone: "tail", volatility: "turn", anchor: { kind: "before-latest-pair" } },
  // STM content precedes its nudge so equal-depth inserts keep the content above the nudge.
  { tag: "stm_content", zone: "tail", volatility: "clock", anchor: { kind: "dialogue-depth" } },
  { tag: "stm_nudge", zone: "tail", volatility: "turn", anchor: { kind: "dialogue-depth" } },
  { tag: "combined_tail", zone: "tail", volatility: "turn", anchor: { kind: "append" } },
  { tag: "queued_reply", zone: "tail", volatility: "turn", anchor: { kind: "append" } },
  { tag: "uncensor", zone: "tail", volatility: "static", anchor: { kind: "append" } },
];

const entriesByTag = new Map(PROMPT_LAYOUT.map((entry) => [entry.tag, entry]));

export function isPromptSystemItem(item: StructuredContextItem): boolean {
  if (item.metadataTag === undefined) return item.role === "system";
  const entry = entriesByTag.get(item.metadataTag);
  return (entry?.roleZones?.[item.role] ?? entry?.zone) === "system";
}

export function presetFlushTags(flush: "knowledge" | "dialogue"): Set<ContextItemTag> {
  return new Set(
    PROMPT_LAYOUT.filter((entry) => entry.presetFlush === flush).map((entry) => entry.tag as ContextItemTag),
  );
}

export function novelaiLayoutTags(kind: "admitted" | "persistent" | "memory"): Set<ContextItemTag> {
  return new Set(
    PROMPT_LAYOUT.filter(
      (entry) =>
        entry.novelai &&
        (kind === "admitted" ||
          entry.novelai === "memory" ||
          (kind === "persistent" && entry.novelai === "personality")),
    ).map((entry) => entry.tag as ContextItemTag),
  );
}

export function orderNativePromptBlocks(items: StructuredContextItem[]): void {
  // History and notes share a rank because simplified-message anchors already interleave notes after date spacers.
  const order = new Map<ContextItemTag | PromptInsertTag | undefined, number>(
    PROMPT_LAYOUT.map((entry, index) => [
      entry.tag,
      entry.anchor.kind === "history"
        ? PROMPT_LAYOUT.findIndex((candidate) => candidate.anchor.kind === "history")
        : index,
    ]),
  );
  items.sort(
    (a, b) => (order.get(a.metadataTag) ?? PROMPT_LAYOUT.length) - (order.get(b.metadataTag) ?? PROMPT_LAYOUT.length),
  );
}

export interface PromptLayoutInsert {
  tag: PromptInsertTag;
  items: StructuredContextItem[];
  depth?: number;
  emitted?: boolean;
}

export function applyPromptLayoutInserts(
  items: StructuredContextItem[],
  inserts: PromptLayoutInsert[],
  messagePosition?: { index: number; total: number; flush?: boolean },
): void {
  for (const entry of PROMPT_LAYOUT) {
    for (const insert of inserts) {
      if (insert.tag !== entry.tag) continue;
      if (entry.anchor.kind === "simplified-message") {
        if (!messagePosition || insert.emitted) continue;
        const depth = entry.anchor.depth === "configured" ? (insert.depth ?? 0) : entry.anchor.depth;
        if (!messagePosition.flush && messagePosition.index !== Math.max(0, messagePosition.total - depth)) continue;
        items.push(...insert.items);
        insert.emitted = true;
      } else if (!messagePosition) {
        for (const item of insert.items) {
          if (entry.anchor.kind === "before-latest-pair") insertBeforeLatestDialoguePair(items, item);
          else if (entry.anchor.kind === "dialogue-depth") {
            if (insert.tag === "stm_content" && (insert.depth ?? -1) < 0) continue;
            insertAtDialogueDepth(items, item, insert.depth ?? 0);
          } else if (entry.anchor.kind === "append") items.push(item);
        }
      }
    }
  }
}

export function insertBeforeLatestDialoguePair(
  contextSegments: StructuredContextItem[],
  injectedItem: StructuredContextItem,
): void {
  const dialogueIndexes: number[] = [];

  for (let index = contextSegments.length - 1; index >= 0; index--) {
    const item = contextSegments[index];
    if (item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && (item.role === "user" || item.role === "model")) {
      dialogueIndexes.push(index);
      if (dialogueIndexes.length === 2) break;
    }
  }

  if (dialogueIndexes.length === 0) {
    contextSegments.push(injectedItem);
    return;
  }

  const insertAt = dialogueIndexes.length >= 2 ? dialogueIndexes[1] : dialogueIndexes[0];
  contextSegments.splice(insertAt, 0, injectedItem);
}

export function insertAtDialogueDepth(
  items: StructuredContextItem[],
  nudge: StructuredContextItem,
  depth: number,
): void {
  if (depth <= 0) {
    items.push(nudge);
    return;
  }
  let found = 0;
  let lastFoundIndex = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY) {
      found++;
      lastFoundIndex = i;
      if (found === depth) {
        items.splice(i, 0, nudge);
        return;
      }
    }
  }

  if (lastFoundIndex !== -1) {
    items.splice(lastFoundIndex, 0, nudge);
  } else {
    items.push(nudge);
  }
}
