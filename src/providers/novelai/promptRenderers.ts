import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import { getNovelAiThinkingDirective } from "@/utils/provider/thinkingControl";

const PERSISTENT_TAGS: ContextItemTag[] = [
  ContextItemTag.SYSTEM_PERSONALITY,
  ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
  ContextItemTag.KNOWLEDGE_USER_MEMORIES,
  ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
];

// Xialong's official client uses four quality stars when no value is configured.
const XIALONG_DEFAULT_STARS = 4;

function itemText(item: StructuredContextItem): string {
  return item.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
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
  const sampleDialogueParts: string[] = [];
  const historyParts: string[] = [];
  let personalityText = "";
  let memoriesText = "";
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
    if (item.metadataTag && PERSISTENT_TAGS.includes(item.metadataTag)) {
      switch (item.metadataTag) {
        case ContextItemTag.SYSTEM_PERSONALITY:
          personalityText = textContent;
          break;
        case ContextItemTag.KNOWLEDGE_SERVER_MEMORIES:
        case ContextItemTag.KNOWLEDGE_USER_MEMORIES:
        case ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY:
          memoriesText = [memoriesText, textContent].filter(Boolean).join("\n");
          break;
      }
    }
    if (
      (item.role === "user" || item.role === "model") &&
      !(item.metadataTag && PERSISTENT_TAGS.includes(item.metadataTag))
    ) {
      if (item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE) {
        if (item.role === "user" && !/^[^\n:]+:\s/.test(textContent)) {
          sampleDialogueParts.push(`${defaultSpeakerLabel}: ${textContent}`);
        } else {
          sampleDialogueParts.push(textContent);
        }
      } else if (item.metadataTag === ContextItemTag.DIALOGUE_HISTORY) {
        historyParts.push(textContent);
      }
    }
  }
  const systemBlocks: string[] = [];
  if (personalityText) {
    systemBlocks.push(`Characters:\n${botName}\n${personalityText}`);
  }
  if (memoriesText) {
    systemBlocks.push(`Server Notes:\n${memoriesText}`);
  }
  const attgPrefix = options?.attgBlock ? `${options.attgBlock}\n` : "";
  const systemHeader = systemBlocks.length > 0 ? `${attgPrefix}${systemBlocks.join("\n")}` : attgPrefix.trimEnd();
  const sampleText = sampleDialogueParts.join("\n");
  const historyText = historyParts.join("\n");
  const styledSampleText = sampleText.trim() ? `[ Style: chat ]\n${sampleText}` : "";
  const styledHistoryText = historyText.trim() ? `[ Style: chat ]\n${historyText}` : "";
  const parts = [systemHeader, styledSampleText, styledHistoryText].filter((p) => p?.trim());
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
  const systemInstructionParts: string[] = [];
  const dialogueTurns: Array<{
    role: "user" | "model";
    content: string;
  }> = [];
  for (const item of contextItems) {
    const textContent = itemText(item);
    if (!textContent) {
      continue;
    }
    if (item.metadataTag) {
      if (PERSISTENT_TAGS.includes(item.metadataTag)) {
        systemInstructionParts.push(textContent);
      }
    }
    if (item.role === "user" || item.role === "model") {
      if (item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE || item.metadataTag === ContextItemTag.DIALOGUE_HISTORY) {
        dialogueTurns.push({
          role: item.role,
          content: textContent,
        });
      }
    }
  }
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
  const persistent = [
    options.attgBlock,
    ...contextItems.filter((item) => item.metadataTag && PERSISTENT_TAGS.includes(item.metadataTag)).map(itemText),
  ].filter(Boolean);
  const parts = ["[gMASK]<sop>", "<|system|>", systemPrompt];
  const thinking = getNovelAiThinkingDirective(options.thinkingLevel, options.forceReason, false) !== "/nothink";
  let firstUser = true;
  for (const item of contextItems.filter(
    (item) =>
      item.metadataTag === ContextItemTag.DIALOGUE_HISTORY || item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE,
  )) {
    if (options.outputPrefill && item === contextItems.at(-1) && item.completionText === options.outputPrefill)
      continue;
    let content = itemText(item);
    if (item.role === "user") {
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
