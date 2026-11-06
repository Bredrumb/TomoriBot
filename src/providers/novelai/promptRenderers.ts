import { novelaiLayoutTags } from "@/utils/text/context/promptLayout";
import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import { getNovelAiThinkingDirective } from "@/utils/provider/thinkingControl";

const persistentTags = novelaiLayoutTags("persistent");
const loreTags = novelaiLayoutTags("lore");

// Xialong's official client uses four quality stars when no value is configured.
const XIALONG_DEFAULT_STARS = 4;

function itemText(item: StructuredContextItem): string {
  return item.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function isPersistentItem(item: StructuredContextItem): boolean {
  return Boolean(
    item.metadataTag &&
      persistentTags.has(item.metadataTag) &&
      (!loreTags.has(item.metadataTag) || item.role === "system"),
  );
}

function isActivatedLore(item: StructuredContextItem): boolean {
  return item.role === "user" && Boolean(item.metadataTag && loreTags.has(item.metadataTag));
}

function collectChatTurns(contextItems: StructuredContextItem[]) {
  const turns: Array<{ role: StructuredContextItem["role"]; content: string; item: StructuredContextItem }> = [];
  for (const item of contextItems) {
    const content = itemText(item);
    if (!content) continue;
    if (isActivatedLore(item)) {
      const previous = turns.at(-1);
      if (previous?.role === "system") previous.content += `\n${content}`;
      else turns.push({ role: "system", content, item });
    } else if (
      (item.role === "user" || item.role === "model") &&
      (item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE || item.metadataTag === ContextItemTag.DIALOGUE_HISTORY)
    ) {
      turns.push({ role: item.role, content, item });
    }
  }
  return turns;
}

export function buildAttgBlock(tomoriState: TomoriState, model: string): string | null {
  const parts: string[] = [];
  if (tomoriState.nai_attg_author?.trim()) parts.push(`Author: ${tomoriState.nai_attg_author.trim()}`);
  if (tomoriState.nai_attg_title?.trim()) parts.push(`Title: ${tomoriState.nai_attg_title.trim()}`);
  if (tomoriState.nai_attg_tags?.trim()) parts.push(`Tags: ${tomoriState.nai_attg_tags.trim()}`);
  if (tomoriState.nai_attg_genre?.trim()) parts.push(`Genre: ${tomoriState.nai_attg_genre.trim()}`);
  const mainBlock = parts.length > 0 ? `[ ${parts.join("; ")} ]` : "";
  const supportsStars = model === "llama-3-erato-v1" || model === "xialong-v1";
  const stars = tomoriState.nai_attg_stars ?? (model === "xialong-v1" ? XIALONG_DEFAULT_STARS : null);
  const starsBlock = supportsStars && stars != null && stars >= 1 && stars <= 5 ? `[ S: ${stars} ]` : "";
  const full = `${mainBlock}${starsBlock}`;
  return full || null;
}

export function assembleNovelAIPrompt(
  contextItems: StructuredContextItem[],
  botName: string,
  options?: {
    attgBlock?: string | null;
  },
): string {
  const dialogueBlocks: string[][] = [];
  let dialogueTag: ContextItemTag | undefined;
  let personalityText = "";
  let memoriesText = "";
  const loreParts: string[] = [];
  let defaultSpeakerLabel = "User";
  // Samples without labels inherit the live user's label for multi-user chat consistency.
  for (const scanItem of contextItems) {
    if (scanItem.metadataTag === ContextItemTag.DIALOGUE_HISTORY && scanItem.role === "user") {
      const scanText = itemText(scanItem);
      const labelMatch = scanText.match(/^([^\n:]+):\s/);
      if (labelMatch) {
        defaultSpeakerLabel = labelMatch[1];
        break;
      }
    }
  }
  for (const item of contextItems) {
    const textContent = itemText(item);
    if (!textContent) continue;
    if (isPersistentItem(item)) {
      switch (item.metadataTag) {
        case ContextItemTag.SYSTEM_PERSONALITY:
          personalityText = textContent;
          break;
        case ContextItemTag.KNOWLEDGE_SERVER_MEMORIES:
        case ContextItemTag.KNOWLEDGE_USER_MEMORIES:
        case ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY:
          memoriesText = [memoriesText, textContent].filter(Boolean).join("\n");
          break;
        case ContextItemTag.KNOWLEDGE_LOREBOOK_BEFORE:
        case ContextItemTag.KNOWLEDGE_LOREBOOK_AFTER:
          loreParts.push(textContent);
          break;
      }
    }
    const isDialogue =
      (item.role === "user" || item.role === "model") &&
      (item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE || item.metadataTag === ContextItemTag.DIALOGUE_HISTORY);
    if (isDialogue || isActivatedLore(item)) {
      if (!dialogueBlocks.length || (isDialogue && dialogueTag && dialogueTag !== item.metadataTag)) {
        dialogueBlocks.push([]);
      }
      if (isDialogue) dialogueTag = item.metadataTag;
      const content =
        item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE && item.role === "user" && !/^[^\n:]+:\s/.test(textContent)
          ? `${defaultSpeakerLabel}: ${textContent}`
          : textContent;
      dialogueBlocks.at(-1)?.push(content);
    }
  }
  const systemBlocks: string[] = [];
  if (personalityText) {
    systemBlocks.push(`Characters:\n${botName}\n${personalityText}`);
  }
  const notes = [memoriesText, ...loreParts].filter(Boolean).join("\n");
  if (notes) {
    systemBlocks.push(`Server Notes:\n${notes}`);
  }
  const attgPrefix = options?.attgBlock ? `${options.attgBlock}\n` : "";
  const systemHeader = systemBlocks.length > 0 ? `${attgPrefix}${systemBlocks.join("\n")}` : attgPrefix.trimEnd();
  const parts = [systemHeader, ...dialogueBlocks.map((block) => `[ Style: chat ]\n${block.join("\n")}`)].filter((p) =>
    p?.trim(),
  );
  return parts.join("\n***\n");
}

export function assembleGlmChatPrompt(
  contextItems: StructuredContextItem[],
  botName: string,
  charPrefixEnabled: boolean,
  options?: {
    thinkingLevel?: string | null;
    forceReason?: boolean;
    thinkingByDefault?: boolean;
  },
): string {
  const systemInstructionParts = contextItems.filter(isPersistentItem).map(itemText);
  const dialogueTurns = collectChatTurns(contextItems);
  const thinkDirective = getNovelAiThinkingDirective(
    options?.thinkingLevel,
    options?.forceReason,
    options?.thinkingByDefault,
  );
  const promptParts: string[] = [];
  promptParts.push("[gMASK]<sop>");
  let persistentPending = systemInstructionParts.length > 0;
  const botNamePrefixPattern = new RegExp(`^${escapeRegExp(botName)}:\\s*`, "i");
  for (const turn of dialogueTurns) {
    if (turn.role === "user") {
      promptParts.push("<|user|>");
      promptParts.push(
        persistentPending
          ? `Relevant persistent information:\n${systemInstructionParts.join("\n")}\n***\n${turn.content}`
          : turn.content,
      );
      persistentPending = false;
    } else if (turn.role === "system") {
      promptParts.push("<|system|>", turn.content);
    } else if (turn.role === "model") {
      promptParts.push("<|assistant|>");
      promptParts.push(thinkDirective);
      if (charPrefixEnabled) {
        promptParts.push(turn.content);
      } else {
        promptParts.push(turn.content.replace(botNamePrefixPattern, ""));
      }
    }
  }
  if (persistentPending)
    promptParts.push("<|user|>", `Relevant persistent information:\n${systemInstructionParts.join("\n")}`);
  promptParts.push("<|assistant|>");
  promptParts.push(thinkDirective);
  if (charPrefixEnabled) {
    promptParts.push(`${botName}:`);
  }
  return promptParts.join("\n");
}

export function assembleXialongPrompt(
  contextItems: StructuredContextItem[],
  systemPrompt: string,
  options: { attgBlock: string | null; outputPrefill?: string; thinkingLevel?: string | null; forceReason?: boolean },
): string {
  const persistent = [options.attgBlock, ...contextItems.filter(isPersistentItem).map(itemText)].filter(Boolean);
  const parts = ["[gMASK]<sop>", "<|system|>", systemPrompt];
  const thinking = getNovelAiThinkingDirective(options.thinkingLevel, options.forceReason, false) !== "/nothink";
  let firstUser = true;
  for (const turn of collectChatTurns(contextItems)) {
    const { item } = turn;
    if (options.outputPrefill && item === contextItems.at(-1) && item.completionText === options.outputPrefill)
      continue;
    let content = turn.content;
    if (turn.role === "system") {
      parts.push("<|system|>", content);
    } else if (turn.role === "user") {
      if (firstUser && persistent.length)
        content = `Relevant persistent information:\n${persistent.join("\n")}\n***\n${content}`;
      firstUser = false;
      parts.push("<|user|>", `${content}${thinking ? "" : "\n/nothink"}`);
    } else {
      parts.push("<|assistant|>", "<think></think>", content);
    }
  }
  if (firstUser && persistent.length)
    parts.push("<|user|>", `Relevant persistent information:\n${persistent.join("\n")}${thinking ? "" : "\n/nothink"}`);
  parts.push("<|assistant|>", thinking ? "<think>" : "<think></think>");
  if (options.outputPrefill) parts.push(options.outputPrefill);
  return parts.join("\n");
}
