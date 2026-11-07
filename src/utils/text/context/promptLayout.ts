import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { VERBATIM_TOOL_CALLING_CONTEXT_DEPTH } from "@/utils/tools/verbatimToolCalling";
import { TIME_AWARENESS_NOTE_DEPTH } from "@/utils/text/context/timeAwareness";

/** Zones identify system-message content, user reference blocks before history, conversation history, and positional tail guidance. */
type PromptZone = "system" | "reference" | "history" | "tail";

/** Volatility identifies config-only edits (static), memory or asset writes (slow), per-turn selection (turn), and wall-time or presence changes (clock). */
type PromptVolatility = "static" | "slow" | "turn" | "clock";

/** Simplified-message anchors run after that message's date spacer, while dialogue-depth anchors count emitted history items from the end. */
type PromptAnchor =
  | { kind: "block" | "history" | "before-latest-pair" | "append" }
  | { kind: "simplified-message"; depth: number | "configured" }
  | { kind: "dialogue-depth" | "tailSlot" };

export const TAIL_SLOT_SPEAKER_TURNS = 4;
export const STM_TAIL_SLOT = Symbol("stmTailSlot");
export const CACHEABLE_PREFIX_END = Symbol("cacheablePrefixEnd");
const APPLIED_LAYOUT_INSERT = Symbol("appliedLayoutInsert");

export type PromptLayoutItem = StructuredContextItem & {
  [STM_TAIL_SLOT]?: true;
  [CACHEABLE_PREFIX_END]?: true;
  [APPLIED_LAYOUT_INSERT]?: Pick<PromptLayoutInsert, "tag" | "depth">;
};

type PromptInsertTag =
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
  novelai?: "personality" | "memory" | "lore" | "sample" | "history";
  role?: StructuredContextItem["role"];
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
  { tag: ContextItemTag.KNOWLEDGE_PERSONA_USER_BLOCKS, zone: "system", volatility: "slow", anchor: { kind: "block" } },
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
    tag: ContextItemTag.KNOWLEDGE_USER_MEMORIES,
    zone: "system",
    roleZones: { user: "reference" },
    volatility: "slow",
    anchor: { kind: "block" },
    novelai: "memory",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
    role: "system",
    zone: "system",
    volatility: "slow",
    anchor: { kind: "block" },
    novelai: "lore",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
    role: "system",
    zone: "system",
    volatility: "slow",
    anchor: { kind: "block" },
    novelai: "lore",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_SERVER_CONDITIONING,
    zone: "system",
    volatility: "slow",
    anchor: { kind: "block" },
    presetFlush: "dialogue",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
    zone: "reference",
    volatility: "slow",
    anchor: { kind: "block" },
    presetFlush: "dialogue",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
    zone: "reference",
    volatility: "slow",
    anchor: { kind: "block" },
    presetFlush: "dialogue",
    novelai: "memory",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS,
    zone: "reference",
    volatility: "slow",
    anchor: { kind: "block" },
  },
  {
    tag: ContextItemTag.DIALOGUE_SAMPLE,
    zone: "history",
    volatility: "slow",
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
  { tag: "stm_content", zone: "tail", volatility: "clock", anchor: { kind: "tailSlot" } },
  {
    tag: ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE,
    role: "user",
    zone: "tail",
    volatility: "turn",
    anchor: { kind: "tailSlot" },
    novelai: "lore",
  },
  {
    tag: ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER,
    role: "user",
    zone: "tail",
    volatility: "turn",
    anchor: { kind: "tailSlot" },
    novelai: "lore",
  },
  { tag: ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES, zone: "tail", volatility: "turn", anchor: { kind: "tailSlot" } },
  { tag: ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS, zone: "tail", volatility: "turn", anchor: { kind: "tailSlot" } },
  { tag: ContextItemTag.KNOWLEDGE_USER_STATUS, zone: "tail", volatility: "clock", anchor: { kind: "tailSlot" } },
  { tag: ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT, zone: "tail", volatility: "clock", anchor: { kind: "tailSlot" } },
  { tag: "stm_nudge", zone: "tail", volatility: "turn", anchor: { kind: "dialogue-depth" } },
  { tag: "combined_tail", zone: "tail", volatility: "turn", anchor: { kind: "append" } },
  { tag: "queued_reply", zone: "tail", volatility: "turn", anchor: { kind: "append" } },
  { tag: "uncensor", zone: "tail", volatility: "static", anchor: { kind: "append" } },
];

function layoutEntry(item: StructuredContextItem): PromptLayoutEntry | undefined {
  return PROMPT_LAYOUT.find((entry) => entry.tag === item.metadataTag && (!entry.role || entry.role === item.role));
}

export function isPromptTailSlotItem(item: StructuredContextItem): boolean {
  return layoutEntry(item)?.anchor.kind === "tailSlot";
}

export function isPromptSystemItem(item: StructuredContextItem): boolean {
  if (item.metadataTag === undefined) return item.role === "system";
  const entry = layoutEntry(item);
  return (entry?.roleZones?.[item.role] ?? entry?.zone) === "system";
}

export function presetFlushTags(flush: "knowledge" | "dialogue"): Set<ContextItemTag> {
  return new Set(
    PROMPT_LAYOUT.filter((entry) => entry.presetFlush === flush).map((entry) => entry.tag as ContextItemTag),
  );
}

export function novelaiLayoutTags(kind: "admitted" | "persistent" | "memory" | "lore"): Set<ContextItemTag> {
  return new Set(
    PROMPT_LAYOUT.filter((entry) => {
      if (kind === "lore") return entry.novelai === "lore";
      return (
        entry.novelai &&
        (kind === "admitted" ||
          entry.novelai === "memory" ||
          entry.novelai === "lore" ||
          (kind === "persistent" && entry.novelai === "personality"))
      );
    }).map((entry) => entry.tag as ContextItemTag),
  );
}

export function orderNativePromptBlocks(items: StructuredContextItem[]): void {
  // History and notes share a rank because simplified-message anchors already interleave notes after date spacers.
  const historyIndex = PROMPT_LAYOUT.findIndex((entry) => entry.anchor.kind === "history");
  const rank = (item: StructuredContextItem) => {
    const entry = layoutEntry(item);
    return entry?.anchor.kind === "history"
      ? historyIndex
      : entry
        ? PROMPT_LAYOUT.indexOf(entry)
        : PROMPT_LAYOUT.length;
  };
  items.sort((left, right) => rank(left) - rank(right));
}

export interface PromptLayoutInsert {
  tag: PromptInsertTag | ContextItemTag;
  items: StructuredContextItem[];
  depth?: number;
  emitted?: boolean;
}

export function getPromptLayoutInsert(item: StructuredContextItem): PromptLayoutInsert | undefined {
  const applied = (item as PromptLayoutItem)[APPLIED_LAYOUT_INSERT];
  if (applied) return { ...applied, items: [item] };
  if (isPromptTailSlotItem(item)) return { tag: item.metadataTag as ContextItemTag, items: [item] };
  return undefined;
}

export function applyPromptLayoutInserts(
  items: StructuredContextItem[],
  inserts: PromptLayoutInsert[],
  messagePosition?: { index: number; total: number; flush?: boolean },
): void {
  if (!messagePosition) {
    const inlineInserts: PromptLayoutInsert[] = [];
    for (let index = 0; index < items.length; ) {
      const item = items[index];
      const insert = getPromptLayoutInsert(item);
      if (insert) {
        inlineInserts.push(insert);
        items.splice(index, 1);
      } else index++;
    }
    inserts = [...inserts, ...inlineInserts];
  }
  const slotIndex = messagePosition ? -1 : resolveTailSlotIndex(items);
  const slotItem = items[slotIndex];
  const prefixEnd = items[slotIndex - 1];
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
          if (entry.role && item.role !== entry.role) continue;
          (item as PromptLayoutItem)[APPLIED_LAYOUT_INSERT] = { tag: insert.tag, depth: insert.depth };
          if (entry.anchor.kind === "before-latest-pair") insertBeforeLatestDialoguePair(items, item);
          else if (entry.anchor.kind === "tailSlot") {
            const tailIndex = slotItem ? items.indexOf(slotItem) : items.length;
            if (insert.tag === "stm_content") {
              const fresh = (item as PromptLayoutItem)[STM_TAIL_SLOT];
              if (!fresh && (insert.depth ?? -1) < 0) continue;
              const depthIndex =
                (insert.depth ?? -1) < 0 ? tailIndex : resolveDialogueDepthIndex(items, insert.depth ?? 0);
              items.splice(fresh ? Math.max(tailIndex, depthIndex) : depthIndex, 0, item);
            } else items.splice(tailIndex, 0, item);
          } else if (entry.anchor.kind === "dialogue-depth") {
            insertAtDialogueDepth(items, item, insert.depth ?? 0);
          } else if (entry.anchor.kind === "append") items.push(item);
        }
      }
    }
  }
  if (!messagePosition) {
    for (let index = 0; index < items.length; index++) {
      const item = items[index] as PromptLayoutItem;
      if (item === prefixEnd || item[CACHEABLE_PREFIX_END]) {
        const copy = { ...item };
        delete copy[CACHEABLE_PREFIX_END];
        if (item === prefixEnd) copy[CACHEABLE_PREFIX_END] = true;
        items[index] = copy;
      }
    }
  }
}

export function speakerTurnStartIndexes(items: StructuredContextItem[]): number[] {
  const starts: number[] = [];
  let previous: StructuredContextItem["sender"];
  for (const [index, item] of items.entries()) {
    if (item.metadataTag !== ContextItemTag.DIALOGUE_HISTORY || !item.sender) continue;
    if (item.sender.id !== previous?.id || item.sender.type !== previous?.type) starts.push(index);
    previous = item.sender;
  }
  return starts;
}

function rewindHistoryInserts(items: StructuredContextItem[], index: number): number {
  while (index > 0) {
    const previous = items[index - 1];
    if (
      previous.sender ||
      (previous.metadataTag !== ContextItemTag.DIALOGUE_HISTORY &&
        previous.metadataTag !== ContextItemTag.CONTEXT_NOTE_INJECTION)
    )
      break;
    index--;
  }
  return index;
}

function resolveTailSlotIndex(items: StructuredContextItem[]): number {
  const starts = speakerTurnStartIndexes(items);
  if (starts.length >= TAIL_SLOT_SPEAKER_TURNS) {
    return rewindHistoryInserts(items, starts[starts.length - TAIL_SLOT_SPEAKER_TURNS]);
  }
  let index = starts.length > 0 ? rewindHistoryInserts(items, starts[0]) : items.length;
  let remaining = TAIL_SLOT_SPEAKER_TURNS - starts.length;
  let previousRole = starts.length > 0 ? items[starts[0]].role : undefined;
  while (
    index > 0 &&
    items[index - 1].metadataTag === ContextItemTag.DIALOGUE_SAMPLE &&
    (remaining > 0 || items[index - 1].role === previousRole)
  ) {
    index--;
    if (items[index].role !== previousRole) remaining--;
    previousRole = items[index].role;
  }
  return index;
}

/** Returns the last item above the tail slot, marked even when the slot is empty, or undefined when no item precedes it, without recounting speaker turns. */
export function getCacheablePrefixBoundary(items: StructuredContextItem[]): StructuredContextItem | undefined {
  return items.find((item) => (item as PromptLayoutItem)[CACHEABLE_PREFIX_END]);
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
  items.splice(resolveDialogueDepthIndex(items, depth), 0, nudge);
}

function resolveDialogueDepthIndex(items: StructuredContextItem[], depth: number): number {
  if (depth <= 0) {
    return items.length;
  }
  let found = 0;
  let lastFoundIndex = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY) {
      found++;
      lastFoundIndex = i;
      if (found === depth) {
        return i;
      }
    }
  }

  return lastFoundIndex !== -1 ? lastFoundIndex : items.length;
}
