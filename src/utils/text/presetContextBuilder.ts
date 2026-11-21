import { isPromptTailSlotItem, presetFlushTags } from "@/utils/text/context/promptLayout";

import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { CachedPresetData } from "@/utils/cache/stPresetCache";
import { resolvePresetMacros, type MacroContext, type ResolvedNode } from "./stPresetEngine";
import { convertMentions } from "./contextBuilder";
import { log } from "@/utils/misc/logger";
import type { Client } from "discord.js";
import type { ToolPromptMacroResolver } from "@/utils/tools/toolPromptMacros";
import { type MentionMemo, USER_REFERENCE_MACRO_PATTERN } from "@/utils/text/context/mentionNormalizer";

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
  personaLineageId?: number;
  toolPromptMacroResolver?: ToolPromptMacroResolver;
}

const MARKER_TO_TAGS: Record<string, ContextItemTag[]> = {
  // SYSTEM_CHANNEL_PROMPT rides with main for append mode, because replace mode swaps SYSTEM_HUMANIZER_RULES upstream.
  main: [ContextItemTag.SYSTEM_HUMANIZER_RULES, ContextItemTag.SYSTEM_CHANNEL_PROMPT],
  charDescription: [ContextItemTag.SYSTEM_PERSONA_PROMPT],
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
    // Card import folds scenario into attributes until a separate scenario field exists.
    scenario: "",
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
  buckets.delete(tag);
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
  const literalUserReferences = new Map<string, string>();
  // Keep user references copied from live chat literal when a preset inserts the message into its template.
  macroContext.lastChatMessage = macroContext.lastChatMessage.replace(USER_REFERENCE_MACRO_PATTERN, (macro) => {
    const token = `{@${crypto.randomUUID()}}`;
    literalUserReferences.set(token, macro);
    return token;
  });
  const mentionMemo: MentionMemo = new Map();
  const resolveNodeText = async (text: string): Promise<string> => {
    const expanded = await (mentionParams.toolPromptMacroResolver?.expand(text) ?? text);
    if (!expanded.trim()) return "";
    let resolved = await convertMentions(
      expanded,
      mentionParams.client,
      mentionParams.guildId,
      mentionParams.triggererName,
      mentionParams.botName,
      mentionParams.personalMemoriesEnabled,
      undefined,
      "template",
      {
        userFormatted: mentionParams.triggererFormattedName,
        userTerm: mentionParams.triggererAddressTerm,
      },
      mentionMemo,
      undefined,
      mentionParams.personaLineageId,
    );
    for (const [token, macro] of literalUserReferences) resolved = resolved.replaceAll(token, macro);
    return resolved;
  };
  const { resolved, expandedContentMacros } = resolvePresetMacros(nodes, macroContext);

  const tailSlotItems = nativeOutput.contextItems.filter(isPromptTailSlotItem);
  const buckets = groupByTag(nativeOutput.contextItems.filter((item) => !isPromptTailSlotItem(item)));

  const systemNodes: ResolvedNode[] = [];
  const depthNodes: ResolvedNode[] = [];

  for (const node of resolved) {
    // Comment-only nodes never inject even when enabled.
    if (!node.is_enabled || node.is_comment) continue;

    if (node.injection_position === 1) {
      depthNodes.push(node);
    } else {
      systemNodes.push(node);
    }
  }

  // Ascending depth puts lower-depth injections closer to the end of history so order matches SillyTavern.
  depthNodes.sort((a, b) => {
    if (a.injection_depth !== b.injection_depth) {
      return a.injection_depth - b.injection_depth;
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

      // Native builder shares the tag across system and persona prompts, so main pulls only the first item.
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
      const resolvedContent = await resolveNodeText(node.content);
      if (!resolvedContent) continue;

      contextItems.push({
        role: node.role,
        parts: [{ type: "text", text: resolvedContent }],
      });
    }
  }

  // Flush unanchored TomoriBot blocks before draining remaining buckets so they precede dialogue history.
  flushKnowledgeBlocks();
  flushDialogueBlocks();

  for (const [_tag, items] of buckets) {
    if (items.length > 0) {
      contextItems.push(...items);
    }
  }

  // Batch depth injections into existing history items instead of creating messages so formatting matches SillyTavern.
  const resolvedInjections: Array<{
    depth: number;
    content: string;
    name: string;
  }> = [];

  for (const depthNode of depthNodes) {
    if (depthNode.content.length === 0) continue;

    const resolvedContent = await resolveNodeText(depthNode.content);
    if (!resolvedContent) continue;

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

  // Pass tail directives, uncensor, and deferred STM fields through unchanged because downstream stages anchor them.
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
