import { charsToTokensText } from "@/utils/text/tokenEstimate";
import type { StructuredContextItem } from "@/types/misc/context";
import { getCacheablePrefixBoundary } from "@/utils/text/context/promptLayout";
import { relocateAssistantMediaContextItems } from "@/providers/utils/strictChatCompat";

export function relocateCacheContextItems(contextItems: StructuredContextItem[]): {
  items: StructuredContextItem[];
  boundaryIndex: number;
} {
  const boundary = getCacheablePrefixBoundary(contextItems);
  if (!boundary) return { items: relocateAssistantMediaContextItems(contextItems), boundaryIndex: -1 };
  const end = contextItems.indexOf(boundary) + 1;
  const prefix = relocateAssistantMediaContextItems(contextItems.slice(0, end));
  return {
    items: [...prefix, ...relocateAssistantMediaContextItems(contextItems.slice(end))],
    boundaryIndex: prefix.length - 1,
  };
}

export function isOpenRouterAnthropicModel(model: string): boolean {
  return /^(?:~)?anthropic\//i.test(model);
}

function minimumCacheTokens(model: string): number {
  const name = model
    .toLowerCase()
    .replace(/^(?:~)?anthropic\//, "")
    .replaceAll(".", "-");
  if (/claude-(?:(?:fable|mythos)-5|(?:opus|sonnet|haiku)-5-5|opus-5(?:-|$))/.test(name)) return 512;
  if (/claude-(?:opus-4-7|mythos-preview|(?:3-5-haiku|haiku-3-5|3-haiku))/.test(name)) return 2048;
  if (/claude-(?:opus-4-(?:5|6)|haiku-4-5)/.test(name)) return 4096;
  if (/claude-(?:sonnet-(?:4|5(?:-|$))|opus-4(?:-1|-8)?(?:-|$)|3-(?:5-sonnet|7-sonnet|opus))/.test(name)) return 1024;
  // Unversioned aliases and unknown models use the largest documented minimum until their version is known.
  return 4096;
}

interface CacheMessage {
  role: string;
  content: unknown;
}

function textLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((total, block) => total + (block.type === "text" ? block.text.length : 0), 0);
}

function markLastBlock(message: CacheMessage): void {
  const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
  if (!Array.isArray(blocks) || blocks.length === 0) return;
  message.content = blocks.map((block, index) =>
    index === blocks.length - 1 ? { ...block, cache_control: { type: "ephemeral" } } : block,
  );
}

export function applyAnthropicCacheBreakpoints(
  model: string,
  system: CacheMessage | undefined,
  messages: CacheMessage[],
  boundary: CacheMessage | undefined,
): void {
  const minimum = minimumCacheTokens(model);
  let prefixChars = system ? textLength(system.content) : 0;
  // Skip from the text estimate because exact eligibility requires provider token counts, including tools and media.
  if (system && charsToTokensText(prefixChars) >= minimum) markLastBlock(system);
  for (const message of messages) {
    prefixChars += textLength(message.content);
    if (message === boundary) {
      if (charsToTokensText(prefixChars) >= minimum) markLastBlock(message);
      break;
    }
  }
}
