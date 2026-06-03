// Shared "strict chat-completion" message normalizations.
//
// Several provider APIs require message shapes that others merely tolerate. Historically each
// adapter hardwired its own copy of these rules, which left custom-endpoint proxies (which inherit
// the OpenAI-compatible builder) unable to front strict backends such as Claude. This module
// centralizes the three normalizations behind one tested seam:
//
//   A. Prefix-completion  — vendor "continue this assistant turn" extension (`prefix: true`).
//   B. Role alternation   — merge consecutive same-role turns + guarantee a leading `user` turn.
//   C. Media relocation   — assistant turns cannot carry media; peel it into a synthetic `user`
//                           turn. This one is ALWAYS-ON (universal across OpenAI/Anthropic/Gemini
//                           shaped APIs) and is never gated by a toggle.
//
// A and B are exposed as per-endpoint toggles (`supports_prefix_completion`,
// `strict_role_alternation`); C is unconditional.

/**
 * Minimal message shape shared by the OpenAI-compatible and Anthropic message arrays: a `role`
 * plus `content` that is either a flat string or an array of content parts/blocks. Text parts in
 * both shapes are `{ type: "text", text }`, which is all the role-alternation merge relies on.
 */
export interface NormalizableMessage {
  role: string;
  content: string | Array<Record<string, unknown>>;
}

/**
 * Providers whose built-in behavior REQUIRES strict role alternation regardless of the stored
 * column. Acts as a request-time safety net (D4) so a mis-seeded row can never emit an invalid
 * body. The column on `llms` is the primary source of truth; this is belt-and-suspenders.
 */
const ALTERNATION_REQUIRED_PROVIDERS = new Set<string>(["anthropic"]);

/**
 * Providers whose built-in behavior REQUIRES assistant prefix-completion (the DeepSeek / Z.ai
 * "continue this assistant turn" extension). Same safety-net role as
 * {@link ALTERNATION_REQUIRED_PROVIDERS}.
 */
const PREFIX_COMPLETION_REQUIRED_PROVIDERS = new Set<string>(["deepseek", "zai", "zaicoding"]);

/**
 * @returns `true` when the provider must always apply strict role alternation.
 * @param provider - Provider codename (e.g. "anthropic").
 */
export function providerRequiresAlternation(provider: string): boolean {
  return ALTERNATION_REQUIRED_PROVIDERS.has(provider);
}

/**
 * @returns `true` when the provider must always apply assistant prefix-completion.
 * @param provider - Provider codename (e.g. "deepseek").
 */
export function providerRequiresPrefixCompletion(provider: string): boolean {
  return PREFIX_COMPLETION_REQUIRED_PROVIDERS.has(provider);
}

// ---------------------------------------------------------------------------------------------
// A. Prefix-completion
// ---------------------------------------------------------------------------------------------

/**
 * Sets `prefix: true` on the trailing assistant message when it matches the resolved output
 * prefill, enabling the vendor "continue this turn" completion used by DeepSeek and Z.ai.
 *
 * All four original guards are preserved so the request body is only mutated when it is safe:
 *   1. A non-empty prefill must be present.
 *   2. `messages` must be a non-empty array.
 *   3. The last message must have role `assistant`.
 *   4. Its `content` must exactly equal the prefill (so we only flag a genuine prefill turn).
 *
 * @param requestBody - The OpenAI-shaped request body (mutated in place).
 * @param outputPrefill - The already-trimmed output prefill, or undefined when none is set.
 */
export function applyAssistantPrefixCompletion(
  requestBody: Record<string, unknown>,
  outputPrefill: string | undefined,
): void {
  // 1. Bail when there is no prefill to continue from.
  if (!outputPrefill) {
    return;
  }

  // 2. The body must carry a non-empty messages array.
  const messages = requestBody.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return;
  }

  // 3. The trailing message must be the assistant prefill turn...
  const lastMessage = messages.at(-1) as Record<string, unknown> | undefined;
  if (
    !lastMessage ||
    typeof lastMessage !== "object" ||
    lastMessage.role !== "assistant" ||
    lastMessage.content !== outputPrefill
  ) {
    return;
  }

  // 4. ...so flag it for continuation.
  lastMessage.prefix = true;
}

// ---------------------------------------------------------------------------------------------
// B. Role alternation
// ---------------------------------------------------------------------------------------------

/** Canonical text used when prepending a synthetic leading `user` turn (Anthropic's wording). */
export const CONVERSATION_START_USER_TEXT = "[System: Conversation start]";

/**
 * Normalize message content to an array of content parts/blocks. A plain string becomes a single
 * `{ type: "text", text }` part; an array passes through untouched. Mirrors Anthropic's previous
 * private `normalizeToContentBlocks` so merged output is byte-identical.
 */
function normalizeToParts(content: string | Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content;
}

/**
 * Whether a message carries OpenAI-style top-level tool wiring: `tool_calls` on an assistant turn
 * or `tool_call_id` on a tool result turn. Such turns must NOT be merged — the merge keeps only the
 * run's first message's non-`content` keys (see {@link mergeConsecutiveSameRole}), which would
 * silently drop a second turn's `tool_calls`/`tool_call_id` and orphan the matching tool result,
 * producing an invalid request body. Anthropic carries tool data inside `content` blocks rather
 * than as top-level keys, so this is always `false` there and that path stays byte-identical.
 *
 * @param message - A message to inspect.
 * @returns `true` when the message has top-level tool metadata.
 */
function hasToolMetadata(message: NormalizableMessage): boolean {
  const record = message as unknown as Record<string, unknown>;
  return record.tool_calls !== undefined || record.tool_call_id !== undefined;
}

/**
 * Merge consecutive same-role messages into single messages with combined content parts. An
 * un-merged message is returned unchanged (string content stays a string); only when two adjacent
 * messages share a role are their contents normalized to arrays and concatenated. Non-`content`
 * keys on the first message of a run are preserved.
 *
 * Tool-bearing turns (those with top-level `tool_calls`/`tool_call_id`) act as merge boundaries so
 * their wiring is never dropped (see {@link hasToolMetadata}); this keeps the OpenAI-compatible
 * tool path valid while leaving the Anthropic path byte-identical.
 *
 * @typeParam T - Any {@link NormalizableMessage}-compatible message shape.
 * @param messages - Messages in order.
 * @returns A new array with consecutive same-role runs merged.
 */
export function mergeConsecutiveSameRole<T extends NormalizableMessage>(messages: T[]): T[] {
  // 1. Empty input → empty output.
  if (messages.length === 0) {
    return [];
  }

  const merged: T[] = [];
  let current = messages[0];

  // 2. Walk the list, folding each same-role neighbor into the current run.
  for (let i = 1; i < messages.length; i++) {
    const next = messages[i];
    // Merge only same-role neighbors, and never across a tool-bearing turn (which would drop its
    // top-level tool_calls/tool_call_id — see hasToolMetadata).
    if (current.role === next.role && !hasToolMetadata(current) && !hasToolMetadata(next)) {
      const combined = [...normalizeToParts(current.content), ...normalizeToParts(next.content)];
      // Preserve any extra keys on the run's first message while overriding content.
      current = { ...current, content: combined };
    } else {
      merged.push(current);
      current = next;
    }
  }

  // 3. Flush the trailing run.
  merged.push(current);
  return merged;
}

/**
 * Guarantee that the first dialogue turn is `user` by prepending a synthetic user turn when the
 * first `user`/`assistant` message is an `assistant` turn. Leading non-dialogue messages (e.g. a
 * `system` turn carried in the array) are skipped so the inserted turn lands in the right place.
 *
 * @typeParam T - Any {@link NormalizableMessage}-compatible message shape.
 * @param messages - Messages in order.
 * @param leadingTurnFactory - Builds the synthetic leading `user` turn to insert when needed.
 * @returns A new array, with the synthetic turn inserted when required.
 */
export function ensureLeadingUserTurn<T extends NormalizableMessage>(messages: T[], leadingTurnFactory: () => T): T[] {
  // 1. Locate the first dialogue turn (skip leading system/tool turns).
  const firstDialogueIndex = messages.findIndex((m) => m.role === "user" || m.role === "assistant");

  // 2. Nothing to fix when there is no dialogue or it already starts with a user turn.
  if (firstDialogueIndex === -1 || messages[firstDialogueIndex].role !== "assistant") {
    return messages;
  }

  // 3. Insert the synthetic user turn immediately before the leading assistant turn.
  const result = [...messages];
  result.splice(firstDialogueIndex, 0, leadingTurnFactory());
  return result;
}

// ---------------------------------------------------------------------------------------------
// C. Media relocation (always-on)
// ---------------------------------------------------------------------------------------------

/**
 * Canonical system notice prepended to a synthetic user turn that carries media peeled off an
 * assistant turn. One wording is used across every provider path (the previously divergent
 * Anthropic / OpenRouter `[System: This image was sent by …]` wording is consolidated here).
 *
 * @param imageCount - Number of relocated images (controls singular/plural).
 */
export function assistantMediaRelocationNotice(imageCount: number): string {
  return `[System: The previous assistant message included ${
    imageCount === 1 ? "the following image" : "the following images"
  }.]`;
}

/**
 * Move OpenAI-style `image_url` parts off assistant turns into a following synthetic `user` turn,
 * because the `assistant` role cannot carry media in the input history. Runs unconditionally for
 * every OpenAI-compatible provider path (it is universal, not a per-endpoint capability).
 *
 * For each assistant message whose `content` is an array:
 *   1. Image (`image_url`) parts are peeled out.
 *   2. Remaining text parts are flattened back to a newline-joined string (matching the builder's
 *      prior output), emitted as the assistant turn only when non-empty.
 *   3. Any peeled images are emitted as a trailing `{ role: "user", content: [notice, ...images] }`.
 * Messages with string content, and non-assistant messages, pass through untouched.
 *
 * @param messages - OpenAI-shaped messages in order.
 * @returns A new array with assistant media relocated to synthetic user turns.
 */
export function relocateAssistantMediaToUserTurns(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    // 1. Only assistant turns with array content can hold relocatable media.
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      result.push(message);
      continue;
    }

    const parts = message.content as Array<Record<string, unknown>>;
    const imageParts = parts.filter((part) => part.type === "image_url");

    // 2. No media → flatten/forward without relocation (still collapse to string for consistency).
    if (imageParts.length === 0) {
      const textOnly = flattenTextParts(parts);
      if (textOnly.length > 0) {
        result.push({ role: "assistant", content: textOnly });
      }
      continue;
    }

    // 3. Emit the text-only assistant turn (when there is any text) ...
    const assistantText = flattenTextParts(parts);
    if (assistantText.length > 0) {
      result.push({ role: "assistant", content: assistantText });
    }

    // 4. ... then the synthetic user turn carrying the relocated images.
    result.push({
      role: "user",
      content: [{ type: "text", text: assistantMediaRelocationNotice(imageParts.length) }, ...imageParts],
    });
  }

  return result;
}

/** Join the `text` of all `{ type: "text" }` parts with newlines, ignoring non-text parts. */
function flattenTextParts(parts: Array<Record<string, unknown>>): string {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}
