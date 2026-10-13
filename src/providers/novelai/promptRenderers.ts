import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import { getNovelAiThinkingDirective } from "@/utils/provider/thinkingControl";

const SYSTEM_INSTRUCTION_TAGS_BASE: ContextItemTag[] = [
  ContextItemTag.SYSTEM_INSTRUCTION_BLOCK,
  ContextItemTag.SYSTEM_PERSONALITY,
  ContextItemTag.SYSTEM_HUMANIZER_RULES,
  ContextItemTag.SYSTEM_PERSONA_PROMPT,
  ContextItemTag.KNOWLEDGE_SERVER_INFO,
  ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
  ContextItemTag.KNOWLEDGE_PERSONA_SPRITES,
];

// Erato accepts the quality-star block independently of the other story metadata.
export function buildAttgBlock(tomoriState: TomoriState, model: string): string | null {
  const parts: string[] = [];
  if (tomoriState.nai_attg_author?.trim()) parts.push(`Author: ${tomoriState.nai_attg_author.trim()}`);
  if (tomoriState.nai_attg_title?.trim()) parts.push(`Title: ${tomoriState.nai_attg_title.trim()}`);
  if (tomoriState.nai_attg_tags?.trim()) parts.push(`Tags: ${tomoriState.nai_attg_tags.trim()}`);
  if (tomoriState.nai_attg_genre?.trim()) parts.push(`Genre: ${tomoriState.nai_attg_genre.trim()}`);
  const mainBlock = parts.length > 0 ? `[ ${parts.join("; ")} ]` : "";
  const isErato = model === "llama-3-erato-v1";
  const stars = tomoriState.nai_attg_stars;
  const starsBlock = isErato && stars != null && stars >= 1 && stars <= 5 ? `[ S: ${stars} ]` : "";
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
  const contextParts: string[] = [];
  const historyParts: string[] = [];
  const systemTags = SYSTEM_INSTRUCTION_TAGS_BASE;
  let personalityText = "";
  let memoriesText = "";
  const instructionParts: string[] = [];
  let defaultSpeakerLabel = "User";
  // Samples without labels inherit the live user's label for multi-user chat consistency.
  for (const scanItem of contextItems) {
    if (scanItem.metadataTag === ContextItemTag.DIALOGUE_HISTORY && scanItem.role === "user") {
      const scanText = scanItem.parts
        .filter((p) => p.type === "text")
        .map(
          (p) =>
            (
              p as {
                type: "text";
                text: string;
              }
            ).text,
        )
        .join("\n");
      const labelMatch = scanText.match(/^([^\n:]+):\s/);
      if (labelMatch) {
        defaultSpeakerLabel = labelMatch[1];
        break;
      }
    }
  }
  for (const item of contextItems) {
    const textContent = item.parts
      .filter((p) => p.type === "text")
      .map(
        (p) =>
          (
            p as {
              type: "text";
              text: string;
            }
          ).text,
      )
      .join("\n");
    if (!textContent) continue;
    if (item.metadataTag && systemTags.includes(item.metadataTag)) {
      switch (item.metadataTag) {
        case ContextItemTag.SYSTEM_PERSONALITY:
          personalityText = textContent;
          break;
        case ContextItemTag.KNOWLEDGE_SERVER_MEMORIES:
          memoriesText = textContent;
          break;
        default:
          instructionParts.push(textContent);
      }
    } else if (!item.metadataTag && item.role === "system") {
      instructionParts.push(textContent);
    }
    if (
      (item.role === "user" || item.role === "model") &&
      !(item.metadataTag && systemTags.includes(item.metadataTag))
    ) {
      if (item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE) {
        if (item.role === "user" && !/^[^\n:]+:\s/.test(textContent)) {
          sampleDialogueParts.push(`${defaultSpeakerLabel}: ${textContent}`);
        } else {
          sampleDialogueParts.push(textContent);
        }
      } else if (item.metadataTag === ContextItemTag.DIALOGUE_HISTORY) {
        historyParts.push(textContent);
      } else {
        contextParts.push(textContent);
      }
    }
  }
  const systemBlocks: string[] = [];
  if (personalityText) {
    systemBlocks.push(`Characters:\n${botName}\n${personalityText}`);
  }
  const instructionText = instructionParts.join("\n\n");
  if (instructionText) {
    systemBlocks.push(`${instructionText}`);
  }
  if (memoriesText) {
    systemBlocks.push(`Server Notes:\n${memoriesText}`);
  }
  const attgPrefix = options?.attgBlock ? `${options.attgBlock}\n` : "";
  const systemHeader = systemBlocks.length > 0 ? `${attgPrefix}${systemBlocks.join("\n")}` : attgPrefix.trimEnd();
  const contextText = contextParts.join("\n");
  const sampleText = sampleDialogueParts.join("\n");
  const historyText = historyParts.join("\n");
  const systemSection = [systemHeader, contextText].filter((p) => p?.trim()).join("\n***\n");
  const styledSampleText = sampleText.trim() ? `[ Style: chat ]\n${sampleText}` : "";
  const styledHistoryText = historyText.trim() ? `[ Style: chat ]\n${historyText}` : "";
  const parts = [systemSection, styledSampleText, styledHistoryText].filter((p) => p?.trim());
  return parts.join("\n***\n");
}

export function assembleGlmChatPrompt(
  contextItems: StructuredContextItem[],
  botName: string,
  charPrefixEnabled: boolean,
  options?: {
    thinkingLevel?: string | null;
    forceReason?: boolean;
  },
): string {
  const systemInstructionParts: string[] = [];
  const dialogueTurns: Array<{
    role: "user" | "model";
    content: string;
  }> = [];
  const systemTags = SYSTEM_INSTRUCTION_TAGS_BASE;
  for (const item of contextItems) {
    const textContent = item.parts
      .filter((p) => p.type === "text")
      .map(
        (p) =>
          (
            p as {
              type: "text";
              text: string;
            }
          ).text,
      )
      .join("\n");
    if (!textContent) {
      continue;
    }
    if (item.metadataTag) {
      if (systemTags.includes(item.metadataTag)) {
        systemInstructionParts.push(textContent);
      }
    } else if (item.role === "system") {
      systemInstructionParts.push(textContent);
    }
    if ((item.role === "user" || item.role === "model") && textContent) {
      const isInSystemTags = item.metadataTag && systemTags.includes(item.metadataTag);
      if (!isInSystemTags) {
        dialogueTurns.push({
          role: item.role,
          content: textContent,
        });
      }
    }
  }
  const thinkDirective = getNovelAiThinkingDirective(options?.thinkingLevel, options?.forceReason);
  const promptParts: string[] = [];
  promptParts.push("[gMASK]<sop>");
  if (systemInstructionParts.length > 0) {
    promptParts.push("<|system|>");
    promptParts.push(systemInstructionParts.join("\n\n"));
  }
  const botNamePrefixPattern = new RegExp(`^${escapeRegExp(botName)}:\\s*`, "i");
  for (const turn of dialogueTurns) {
    if (turn.role === "user") {
      promptParts.push("<|user|>");
      promptParts.push(turn.content);
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
  promptParts.push("<|assistant|>");
  promptParts.push(thinkDirective);
  if (charPrefixEnabled) {
    promptParts.push(`${botName}:`);
  }
  return promptParts.join("\n");
}
