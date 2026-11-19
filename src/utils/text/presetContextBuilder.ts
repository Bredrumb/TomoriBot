import { isPromptTailSlotItem, presetFlushTags } from "@/utils/text/context/promptLayout";

import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { CachedPresetData } from "@/utils/cache/stPresetCache";
import { resolvePresetMacros, type MacroContext, type ResolvedNode } from "./stPresetEngine";
import { convertMentions } from "./contextBuilder";
import { log } from "@/utils/misc/logger";
import type { Client } from "discord.js";
import type { ToolPromptMacroResolver } from "@/utils/tools/toolPromptMacros";

interface PresetMacroParams {
  triggererName: string;
  tomoriNickname: string;
  tomoriAttributes: string[];
  personaPrompt: string | null | undefined;
  sampleDialoguesIn: string[];
  sampleDialoguesOut: string[];
  lastUserMessage: string;
  model: string;
  provider: string;
  utcOffsetHours: number | null;
  nowMs: number;
}

interface MentionParams {
  client: Client;
  guildId: string;
  triggererName: string;
  triggererFormattedName: string;
  triggererAddressTerm: string;
  botName: string;
  personalMemoriesEnabled: boolean;
  toolPromptMacroResolver?: ToolPromptMacroResolver;
}

const MARKER_TO_TAGS: Record<string, ContextItemTag[]> = {
  // Primary character blocks. The per-channel append-mode prompt rides with `main`
  // so it stays directly after the system prompt; replace mode already replaces the
  // SYSTEM_HUMANIZER_RULES content upstream, so no separate channel block exists then.
  main: [ContextItemTag.SYSTEM_HUMANIZER_RULES, ContextItemTag.SYSTEM_CHANNEL_PROMPT],
  charDescription: [ContextItemTag.SYSTEM_PERSONA_PROMPT], // Persona prompt tag
  charPersonality: [ContextItemTag.SYSTEM_PERSONALITY],

  dialogueExamples: [ContextItemTag.DIALOGUE_SAMPLE],
  chatHistory: [ContextItemTag.DIALOGUE_HISTORY],

  worldInfoBefore: [ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE],
  worldInfoAfter: [ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER],
};

const TOMORI_ONLY_KNOWLEDGE_TAGS = presetFlushTags("knowledge");

const TOMORI_ONLY_DIALOGUE_TAGS = presetFlushTags("dialogue");

const KNOWLEDGE_FLUSH_ANCHORS = new Set(["charPersonality", "charDescription", "main"]);

const DIALOGUE_FLUSH_ANCHORS = new Set(["dialogueExamples", "chatHistory"]);

const TERMINAL_SAMPLE_DIALOGUE_SPACER =
  "[System: The sample dialogues above are reference material showing how {{char}} speaks. They are not the active conversation. Continue from the current scene or live conversation instead of continuing the examples.]";

function buildMacroContext(params: PresetMacroParams): MacroContext {
  const mesExamples: string[] = [];
  for (let i = 0; i < params.sampleDialoguesIn.length; i++) {
    const userLine = params.sampleDialoguesIn[i];
    const modelLine = params.sampleDialoguesOut[i];
    if (userLine) mesExamples.push(`<START>\n${userLine}`);
    if (modelLine) mesExamples.push(`${params.tomoriNickname}: ${modelLine}`);
  }

  return {
    userName: params.triggererName,
    charName: params.tomoriNickname,
    personality: params.tomoriAttributes.join("\n"),
    description: params.personaPrompt ?? "",
    scenario: "", // Card import folds scenario into attributes until a separate scenario field exists.
    mesExamples: mesExamples.join("\n"),
    lastChatMessage: params.lastUserMessage,
    model: params.model,
    provider: params.provider,
    // Card version stays empty until a second card metadata field warrants shared storage.
    charVersion: "",
    utcOffsetHours: params.utcOffsetHours,
    nowMs: params.nowMs,
  };
}

function groupByTag(contextItems: StructuredContextItem[]): Map<ContextItemTag | "untagged", StructuredContextItem[]> {
  const buckets = new Map<ContextItemTag | "untagged", StructuredContextItem[]>();

  for (const item of contextItems) {
    const key = item.metadataTag ?? "untagged";
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(key, [item]);
    }
  }

  return buckets;
}

function pullBucket(
  buckets: Map<ContextItemTag | "untagged", StructuredContextItem[]>,
  tag: ContextItemTag,
): StructuredContextItem[] {
  const items = buckets.get(tag) ?? [];
  buckets.delete(tag); // Consume the bucket
  return items;
}

function pullFirstFromBucket(
  buckets: Map<ContextItemTag | "untagged", StructuredContextItem[]>,
  tag: ContextItemTag,
): StructuredContextItem | null {
  const items = buckets.get(tag);
  if (!items || items.length === 0) return null;

  // biome-ignore lint/style/noNonNullAssertion: items.length > 0 is checked above, shift() always returns a value
  const first = items.shift()!;
  if (items.length === 0) {
    buckets.delete(tag);
  }
  return first;
}

// A `user` spacer turn is appended when sample dialogues end the prompt, because strict chat APIs reject requests
// ending on an assistant turn.
async function appendTerminalSampleDialogueSpacerIfNeeded(
  contextItems: StructuredContextItem[],
  mentionParams: MentionParams,
): Promise<void> {
  const lastItem = contextItems.at(-1);
  if (!lastItem || lastItem.metadataTag !== ContextItemTag.DIALOGUE_SAMPLE) {
    return;
  }

  const resolvedSpacerText = await convertMentions(
    TERMINAL_SAMPLE_DIALOGUE_SPACER,
    mentionParams.client,
    mentionParams.guildId,
    mentionParams.triggererName,
    mentionParams.botName,
    mentionParams.personalMemoriesEnabled,
    undefined,
    "resolve",
    {
      userFormatted: mentionParams.triggererFormattedName,
      userTerm: mentionParams.triggererAddressTerm,
    },
  );

  contextItems.push({
    role: "user",
    parts: [{ type: "text", text: resolvedSpacerText }],
  });

  log.info("[Preset Builder] Appended terminal sample-dialogue spacer after dialogueExamples ended the prompt");
}

// Inputs must be pre-sorted by depth then `injection_order`, because same-depth grouping preserves input order into
// one block to reduce token overhead.
function batchMergeDepthInjections(
  contextItems: StructuredContextItem[],
  injections: Array<{ depth: number; content: string; name: string }>,
): void {
  const historyIndices: number[] = [];
  for (let i = 0; i < contextItems.length; i++) {
    if (contextItems[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY) {
      historyIndices.push(i);
    }
  }

  if (historyIndices.length === 0) {
    log.warn(`[Preset Builder] Cannot merge ${injections.length} depth injection(s) — no dialogue history items found`);
    return;
  }

  const groupedByTarget = new Map<number, string[]>();

  for (const injection of injections) {
    const targetHistoryIndex = historyIndices.length - 1 - injection.depth;
    const clampedIndex = Math.max(0, Math.min(targetHistoryIndex, historyIndices.length - 1));
    const actualIndex = historyIndices[clampedIndex];

    const group = groupedByTarget.get(actualIndex);
    if (group) {
      group.push(injection.content);
    } else {
      groupedByTarget.set(actualIndex, [injection.content]);
    }
  }

  for (const [actualIndex, contents] of groupedByTarget) {
    const combinedText = contents.join("\n");
    contextItems[actualIndex].parts.push({
      type: "text",
      text: `\n[System: ${combinedText}]`,
    });
  }
}

export async function reassembleWithPreset(
  nativeOutput: {
    contextItems: StructuredContextItem[];
    tailDirectives: string[];
    lowerPriorityTailDirectives: string[];
    uncensorDirective?: string;
    nudgeItem?: StructuredContextItem;
    nudgeInjectionDepth?: number;
    memoryInjectionItems?: StructuredContextItem[];
    memoryInjectionDepth?: number;
    memoryRecall?: import("@/utils/text/context/memoryRecall").MemoryRecallOutcome;
  },
  presetData: CachedPresetData,
  macroParams: PresetMacroParams,
  mentionParams: MentionParams,
): Promise<{
  contextItems: StructuredContextItem[];
  tailDirectives: string[];
  lowerPriorityTailDirectives: string[];
  uncensorDirective?: string;
  nudgeItem?: StructuredContextItem;
  nudgeInjectionDepth?: number;
  memoryInjectionItems?: StructuredContextItem[];
  memoryInjectionDepth?: number;
  memoryRecall?: import("@/utils/text/context/memoryRecall").MemoryRecallOutcome;
}> {
  const { nodes } = presetData;

  const macroContext = buildMacroContext(macroParams);
  const { resolved, expandedContentMacros } = resolvePresetMacros(nodes, macroContext);

  const tailSlotItems = nativeOutput.contextItems.filter(isPromptTailSlotItem);
  const buckets = groupByTag(nativeOutput.contextItems.filter((item) => !isPromptTailSlotItem(item)));

  const systemNodes: ResolvedNode[] = [];
  const depthNodes: ResolvedNode[] = [];

  for (const node of resolved) {
    // Skip disabled nodes and comment-only nodes (is_comment never injects regardless of enabled state)
    if (!node.is_enabled || node.is_comment) continue;

    if (node.injection_position === 1) {
      depthNodes.push(node);
    } else {
      systemNodes.push(node);
    }
  }

  // Sort depth nodes: by depth ascending (matching ST's bottom-to-top processing),
  // then injection_order ascending for same-depth nodes
  depthNodes.sort((a, b) => {
    if (a.injection_depth !== b.injection_depth) {
      return a.injection_depth - b.injection_depth; // Lower depth first (closer to end of history)
    }
    return a.injection_order - b.injection_order;
  });

  const contextItems: StructuredContextItem[] = [];
  let knowledgeFlushed = false;
  let dialogueFlushed = false;

  const flushKnowledgeBlocks = () => {
    if (knowledgeFlushed) return;
    knowledgeFlushed = true;

    for (const tag of TOMORI_ONLY_KNOWLEDGE_TAGS) {
      contextItems.push(...pullBucket(buckets, tag));
    }
  };

  const flushDialogueBlocks = () => {
    if (dialogueFlushed) return;
    dialogueFlushed = true;

    for (const tag of TOMORI_ONLY_DIALOGUE_TAGS) {
      contextItems.push(...pullBucket(buckets, tag));
    }

    const loreBeforeItems = pullBucket(buckets, ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE);
    const loreAfterItems = pullBucket(buckets, ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER);
    contextItems.push(...loreBeforeItems, ...loreAfterItems);
  };

  for (const node of systemNodes) {
    if (node.is_marker) {
      const markerTags = MARKER_TO_TAGS[node.identifier];

      if (!markerTags) {
        log.warn(
          `[Preset Builder] Unrecognized marker "${node.identifier}" (node_order ${node.node_order}) — skipping`,
        );
      }

      // The native builder puts system prompt + persona prompt under this single tag.
      // `main` takes only the first item (system prompt), `charDescription` takes the rest (persona).
      if (node.identifier === "main") {
        if (markerTags) {
          for (const tag of markerTags) {
            const firstItem = pullFirstFromBucket(buckets, tag);
            if (firstItem) contextItems.push(firstItem);
          }
        }
        if (KNOWLEDGE_FLUSH_ANCHORS.has(node.identifier)) {
          flushKnowledgeBlocks();
        }
        continue;
      }

      if (node.identifier === "charDescription") {
        if (expandedContentMacros.has("description")) {
          if (KNOWLEDGE_FLUSH_ANCHORS.has(node.identifier)) {
            flushKnowledgeBlocks();
          }
          continue;
        }
        if (markerTags) {
          for (const tag of markerTags) {
            contextItems.push(...pullBucket(buckets, tag));
          }
        }
        if (KNOWLEDGE_FLUSH_ANCHORS.has(node.identifier)) {
          flushKnowledgeBlocks();
        }
        continue;
      }

      if (node.identifier === "charPersonality") {
        if (expandedContentMacros.has("personality")) {
          if (KNOWLEDGE_FLUSH_ANCHORS.has(node.identifier)) {
            flushKnowledgeBlocks();
          }
          continue;
        }
      }

      if (DIALOGUE_FLUSH_ANCHORS.has(node.identifier)) {
        flushDialogueBlocks();
      }

      if (markerTags) {
        for (const tag of markerTags) {
          contextItems.push(...pullBucket(buckets, tag));
        }
      }

      if (KNOWLEDGE_FLUSH_ANCHORS.has(node.identifier)) {
        flushKnowledgeBlocks();
      }
    } else if (node.content.length > 0) {
      const toolMacroExpandedContent = await (mentionParams.toolPromptMacroResolver?.expand(node.content) ??
        Promise.resolve(node.content));
      if (!toolMacroExpandedContent.trim()) continue;
      const resolvedContent = await convertMentions(
        toolMacroExpandedContent,
        mentionParams.client,
        mentionParams.guildId,
        mentionParams.triggererName, // Preset custom nodes should resolve {{user}} to the actual triggerer
        mentionParams.botName,
        mentionParams.personalMemoriesEnabled,
        undefined,
        "resolve",
        {
          userFormatted: mentionParams.triggererFormattedName,
          userTerm: mentionParams.triggererAddressTerm,
        },
      );

      contextItems.push({
        role: node.role,
        parts: [{ type: "text", text: resolvedContent }],
      });
    }
  }

  // ── Step 5: Flush any remaining TomoriBot-only blocks ──
  // If the preset's node order didn't include the anchor markers,
  // append remaining blocks before dialogue history.
  flushKnowledgeBlocks();
  flushDialogueBlocks();

  for (const [_tag, items] of buckets) {
    if (items.length > 0) {
      contextItems.push(...items);
    }
  }

  // Depth-injection nodes merge INTO existing dialogue history items rather than creating new
  // messages. Same-depth injections are batched into a single [System: ...] block to reduce
  // token waste and match SillyTavern's contiguous injection behavior.
  const resolvedInjections: Array<{
    depth: number;
    content: string;
    name: string;
  }> = [];

  for (const depthNode of depthNodes) {
    if (depthNode.content.length === 0) continue;

    const toolMacroExpandedContent = await (mentionParams.toolPromptMacroResolver?.expand(depthNode.content) ??
      Promise.resolve(depthNode.content));
    if (!toolMacroExpandedContent.trim()) continue;
    const resolvedContent = await convertMentions(
      toolMacroExpandedContent,
      mentionParams.client,
      mentionParams.guildId,
      mentionParams.triggererName,
      mentionParams.botName,
      mentionParams.personalMemoriesEnabled,
      undefined,
      "resolve",
      {
        userFormatted: mentionParams.triggererFormattedName,
        userTerm: mentionParams.triggererAddressTerm,
      },
    );

    resolvedInjections.push({
      depth: depthNode.injection_depth,
      content: resolvedContent,
      name: depthNode.name,
    });
  }

  if (resolvedInjections.length > 0) {
    batchMergeDepthInjections(contextItems, resolvedInjections);
  }

  await appendTerminalSampleDialogueSpacerIfNeeded(contextItems, mentionParams);

  contextItems.push(...tailSlotItems);

  log.info(
    `[Preset Builder] Reassembled ${contextItems.length} context items using preset "${presetData.preset.preset_name}" ` +
      `(${systemNodes.length} system nodes, ${depthNodes.length} depth injections)`,
  );

  // Tail directives, uncensor directive, and the out-of-band STM nudge + deferred STM
  // content block pass through unchanged because they are injected positionally
  // downstream of assembly, so preset reassembly must never re-anchor them.
  return {
    contextItems,
    tailDirectives: nativeOutput.tailDirectives,
    lowerPriorityTailDirectives: nativeOutput.lowerPriorityTailDirectives,
    uncensorDirective: nativeOutput.uncensorDirective,
    nudgeItem: nativeOutput.nudgeItem,
    nudgeInjectionDepth: nativeOutput.nudgeInjectionDepth,
    memoryInjectionItems: nativeOutput.memoryInjectionItems,
    memoryInjectionDepth: nativeOutput.memoryInjectionDepth,
    memoryRecall: nativeOutput.memoryRecall,
  };
}
