import type { ContextPart, StructuredContextItem } from "@/types/misc/context";

// Shared "strict chat-completion" message normalizations: message shapes some provider APIs
// require and others merely tolerate. Three normalizations live behind this one tested seam, so a
// custom-endpoint proxy can front strict backends such as Claude.
//
//   A. Prefix-completion: vendor "continue this assistant turn" extension (`prefix: true`).
//   B. Role alternation: merge consecutive same-role turns + guarantee a leading `user` turn.
//   C. Media relocation: assistant turns cannot carry media; peel it into a synthetic `user`
//      turn. This one is ALWAYS-ON (universal across OpenAI/Anthropic/Gemini shaped APIs) and is
//      never gated by a toggle.
//
// A and B are exposed as per-endpoint toggles, C is unconditional.

export interface NormalizableMessage {
  role: string;
  content: string | Array<Record<string, unknown>>;
}

// Request-time safety net alongside the llms column so a mis-seeded database row cannot emit an invalid body.
const ALTERNATION_REQUIRED_PROVIDERS = new Set<string>(["anthropic"]);

const PREFIX_COMPLETION_REQUIRED_PROVIDERS = new Set<string>(["deepseek", "zai", "zaicoding"]);

// Only DeepSeek is listed here because it rejects prefix: true alongside tools ("Function call should not be used
// with prefix"), whereas Z.ai allows both.
const PREFIX_COMPLETION_EXCLUDES_TOOLS_PROVIDERS = new Set<string>(["deepseek"]);

export function providerPrefixCompletionExcludesTools(provider: string): boolean {
  return PREFIX_COMPLETION_EXCLUDES_TOOLS_PROVIDERS.has(provider);
}

export function providerRequiresAlternation(provider: string): boolean {
  return ALTERNATION_REQUIRED_PROVIDERS.has(provider);
}

export function providerRequiresPrefixCompletion(provider: string): boolean {
  return PREFIX_COMPLETION_REQUIRED_PROVIDERS.has(provider);
}

// DeepSeek thinking mode rejects prefix: true without reasoning_content, so requiresReasoningContent stamps "" while
// keeping Z.ai requests unchanged.
export function applyAssistantPrefixCompletion(
  requestBody: Record<string, unknown>,
  outputPrefill: string | undefined,
  requiresReasoningContent?: boolean,
): void {
  if (!outputPrefill) {
    return;
  }

  // The body must carry a non-empty messages array.
  const messages = requestBody.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return;
  }

  // The trailing message must be the assistant prefill turn...
  const lastMessage = messages.at(-1) as Record<string, unknown> | undefined;
  if (
    !lastMessage ||
    typeof lastMessage !== "object" ||
    lastMessage.role !== "assistant" ||
    lastMessage.content !== outputPrefill
  ) {
    return;
  }

  lastMessage.prefix = true;
  if (requiresReasoningContent && lastMessage.reasoning_content === undefined) {
    lastMessage.reasoning_content = "";
  }
}

export const CONVERSATION_START_USER_TEXT = "[System: Conversation start]";

function normalizeToParts(content: string | Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content;
}

// Tool-bearing turns must not merge because keeping only the first message's non-content keys drops OpenAI
// tool_calls/tool_call_id and orphans tool results.
function hasToolMetadata(message: NormalizableMessage): boolean {
  const record = message as unknown as Record<string, unknown>;
  return record.tool_calls !== undefined || record.tool_call_id !== undefined;
}

export function mergeConsecutiveSameRole<T extends NormalizableMessage>(messages: T[]): T[] {
  if (messages.length === 0) {
    return [];
  }

  const merged: T[] = [];
  let current = messages[0];

  for (let i = 1; i < messages.length; i++) {
    const next = messages[i];
    // Merge only same-role neighbors, and never across a tool-bearing turn (which would drop its
    // top-level tool_calls/tool_call_id: see hasToolMetadata).
    if (current.role === next.role && !hasToolMetadata(current) && !hasToolMetadata(next)) {
      const combined = [...normalizeToParts(current.content), ...normalizeToParts(next.content)];
      const allText = combined.every((part) => part.type === "text" && part.cache_control === undefined);
      current = {
        ...current,
        content: allText ? combined.map((part) => String(part.text)).join("\n") : combined,
      };
    } else {
      merged.push(current);
      current = next;
    }
  }

  merged.push(current);
  return merged;
}

export function ensureLeadingUserTurn<T extends NormalizableMessage>(messages: T[], leadingTurnFactory: () => T): T[] {
  // Locate the first dialogue turn (skip leading system/tool turns).
  const firstDialogueIndex = messages.findIndex((m) => m.role === "user" || m.role === "assistant");

  if (firstDialogueIndex === -1 || messages[firstDialogueIndex].role !== "assistant") {
    return messages;
  }

  const result = [...messages];
  result.splice(firstDialogueIndex, 0, leadingTurnFactory());
  return result;
}

export function assistantMediaRelocationNotice(imageCount: number, senderName?: string | null): string {
  const normalizedSenderName = senderName?.trim();
  const imagePhrase = imageCount === 1 ? "image was" : "images were";

  if (!normalizedSenderName) {
    return `[System: The following ${imagePhrase} sent]`;
  }

  return `[System: The following ${imagePhrase} sent by ${normalizedSenderName}.]`;
}

// Notice must state both that delivery succeeded and that the images are unseen because otherwise an image-blind
// model narrates pictures it never received.
export function unseenToolImageNotice(imageCount: number): string {
  const imagePhrase = imageCount === 1 ? "1 image" : `${imageCount} images`;
  const pronoun = imageCount === 1 ? "it" : "them";

  return (
    `[System: The tool returned ${imagePhrase} and delivered ${pronoun} to the user in Discord, but ` +
    "the current model cannot see images. Do not describe or claim to see the contents. If you need " +
    "to see images, tell the user to set up `/model vision` or to use a model with the vision capability.]"
  );
}

export { isPromptSystemItem as isSystemInstructionContextItem } from "@/utils/text/context/promptLayout";

// Relocation runs before provider serialization while item.sender metadata is still attached so synthetic user turns
// keep per-persona attribution.
export function relocateAssistantMediaContextItems(contextItems: StructuredContextItem[]): StructuredContextItem[] {
  const result: StructuredContextItem[] = [];

  for (const item of contextItems) {
    // Only model turns can carry assistant media that provider APIs reject.
    if (item.role !== "model") {
      result.push(item);
      continue;
    }

    const imageParts = item.parts.filter(isContextImagePart);
    if (imageParts.length === 0) {
      result.push(item);
      continue;
    }

    const remainingParts = item.parts.filter((part) => part.type !== "image");
    if (remainingParts.length > 0) {
      result.push({
        ...item,
        parts: remainingParts,
      });
    }

    result.push({
      role: "user",
      parts: [
        { type: "text", text: assistantMediaRelocationNotice(imageParts.length, item.sender?.name) },
        ...imageParts,
      ],
      ...(item.metadataTag && { metadataTag: item.metadataTag }),
      ...(item.messageId && { messageId: item.messageId }),
      ...(item.sender && { sender: item.sender }),
      ...(item.conversationUsers && { conversationUsers: item.conversationUsers }),
      ...(item.participantTargetIndex && { participantTargetIndex: item.participantTargetIndex }),
      ...(item.personaMentionMap && { personaMentionMap: item.personaMentionMap }),
    });
  }

  return result;
}

// OpenAI-compatible providers cannot carry media on the assistant role in input history, so this runs unconditionally
// rather than per endpoint.
export function relocateAssistantMediaToUserTurns(
  messages: Array<Record<string, unknown>>,
  fallbackSenderName?: string | null,
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    // Only assistant turns with array content can hold relocatable media.
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      result.push(message);
      continue;
    }

    const parts = message.content as Array<Record<string, unknown>>;
    const imageParts = parts.filter((part) => part.type === "image_url");

    if (imageParts.length === 0) {
      const textOnly = flattenTextParts(parts);
      if (textOnly.length > 0) {
        result.push({ role: "assistant", content: textOnly });
      }
      continue;
    }

    // Emit the text-only assistant turn (when there is any text) ...
    const assistantText = flattenTextParts(parts);
    if (assistantText.length > 0) {
      result.push({ role: "assistant", content: assistantText });
    }

    const senderName =
      typeof message.assistantMediaSenderName === "string" ? message.assistantMediaSenderName : fallbackSenderName;
    result.push({
      role: "user",
      content: [{ type: "text", text: assistantMediaRelocationNotice(imageParts.length, senderName) }, ...imageParts],
    });
  }

  return result;
}

function isContextImagePart(part: ContextPart): part is Extract<ContextPart, { type: "image" }> {
  return part.type === "image";
}

function flattenTextParts(parts: Array<Record<string, unknown>>): string {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}
