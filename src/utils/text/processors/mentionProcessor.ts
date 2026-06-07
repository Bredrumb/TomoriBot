import { escapeRegExp } from "./regexUtils";

/**
 * Strips curly braces from unknown template placeholders in text, leaving only the inner word.
 * Valid placeholders ({user}, {bot}, {char} and their double-brace variants) are preserved.
 * This prevents LLM-generated `{username}` artifacts from appearing literally in stored
 * memories or Discord messages when the model incorrectly imitates the `{user}` convention.
 * @param text - Text that may contain erroneous `{word}` placeholders
 * @returns Text with unknown `{word}` braces stripped, valid template vars untouched
 */
export function sanitizeUnknownTemplatePlaceholders(text: string): string {
  const result = text.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_match, inner: string) =>
    /^(user|bot|char)$/i.test(inner) ? `{{${inner}}}` : inner,
  );
  return result.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_match, inner: string) =>
    /^(user|bot|char)$/i.test(inner) ? `{${inner}}` : inner,
  );
}

/**
 * Replaces template variables in a text string with their corresponding values.
 * Supports both `{name}` and `{{name}}` syntaxes, and normalises `char` as an alias for `bot`.
 * @param text - The template string containing placeholders to be replaced
 * @param variables - An object mapping variable names to their values
 * @returns The text with all placeholders replaced with their corresponding values
 */
export function replaceTemplateVariables(text: string, variables: Record<string, string | undefined>): string {
  let result = text;
  const normalizedVariables: Record<string, string | undefined> = {
    ...variables,
    char: variables.char ?? variables.bot,
  };

  for (const [placeholder, value] of Object.entries(normalizedVariables)) {
    if (!value) continue;

    const escapedPlaceholder = escapeRegExp(placeholder);
    const doubleBraceRegex = new RegExp(`\\{\\{\\s*${escapedPlaceholder}\\s*\\}\\}`, "gi");
    const singleBraceRegex = new RegExp(`\\{\\s*${escapedPlaceholder}\\s*\\}`, "gi");
    result = result.replace(doubleBraceRegex, value);
    result = result.replace(singleBraceRegex, value);
  }

  return result;
}

/**
 * Normalizes custom Discord emoji tags into :name: for LLM context.
 * Skips code blocks and inline code to preserve literal examples.
 * @param text - Raw message content from Discord
 * @returns Content with custom emoji tags converted to :name:
 */
export function normalizeCustomEmojisForLlm(text: string): string {
  if (!text) return text;

  const codeBlocks: string[] = [];
  const inlineCode: string[] = [];

  let processedText = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  processedText = processedText.replace(/`[^`]*`/g, (match) => {
    inlineCode.push(match);
    return `__INLINE_CODE_${inlineCode.length - 1}__`;
  });

  processedText = processedText.replace(/<(a?):([^:>]+):\d{17,20}>/g, (_match, _animated, name) => `:${name}:`);

  for (let i = inlineCode.length - 1; i >= 0; i--) {
    processedText = processedText.replace(`__INLINE_CODE_${i}__`, inlineCode[i]);
  }
  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    processedText = processedText.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  return processedText;
}

/**
 * Converts @{name} mention handles into Discord mentions using a provided lookup.
 * Also handles the LLM hallucination variants @(name) and @[name].
 * Skips code blocks and inline code to preserve literal examples.
 * @param text - Raw text from LLM output
 * @param mentionMap - Map of normalized mention handles to user ID candidates
 * @param mentionIdSet - Set of known user IDs for disambiguation
 * @returns Text with mention handles replaced when resolvable
 */
export function replaceMentionHandles(
  text: string,
  mentionMap?: Map<string, string[]>,
  mentionIdSet?: Set<string>,
): string {
  if (!text || !mentionMap || mentionMap.size === 0) return text;

  const codeBlocks: string[] = [];
  const inlineCode: string[] = [];

  let processedText = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  processedText = processedText.replace(/`[^`]*`/g, (match) => {
    inlineCode.push(match);
    return `__INLINE_CODE_${inlineCode.length - 1}__`;
  });

  function resolveHandle(handle: string, match: string): string {
    if (!handle) return match;

    const pipeIndex = handle.lastIndexOf("|");
    if (pipeIndex > -1) {
      const idPart = handle.slice(pipeIndex + 1).trim();
      if (/^\d{17,20}$/.test(idPart) && mentionIdSet?.has(idPart)) return `<@${idPart}>`;
    }

    if (/^\d{17,20}$/.test(handle) && mentionIdSet?.has(handle)) return `<@${handle}>`;

    const normalizedHandle = handle.toLowerCase();
    const ids = mentionMap?.get(normalizedHandle);
    // Fallback: show plain name — {handle} would look like a stray template var
    if (!ids || ids.length !== 1) return handle;
    return `<@${ids[0]}>`;
  }

  processedText = processedText.replace(/@\{([^}]+)\}/g, (match, rawHandle) =>
    resolveHandle((rawHandle as string).trim(), match),
  );

  // @(name) and @(name|id) — LLM hallucination using parentheses
  processedText = processedText.replace(/@\(([^)]+)\)/g, (match, rawHandle) =>
    resolveHandle((rawHandle as string).trim(), match),
  );

  // @[name] and @[name|id] — LLM hallucination using square brackets
  processedText = processedText.replace(/@\[([^\]]+)\]/g, (match, rawHandle) =>
    resolveHandle((rawHandle as string).trim(), match),
  );

  // @name|id format without braces (LLM sometimes omits braces)
  processedText = processedText.replace(
    /(^|[^\p{L}\p{N}_<])@([\p{L}\p{N}_][\p{L}\p{N}_ -]*)\|(\d{17,20})/giu,
    (_match, prefix, rawHandle, idPart) => {
      if (mentionIdSet?.has(idPart)) return `${prefix}<@${idPart}>`;
      return `${prefix}${rawHandle}|${idPart}`;
    },
  );

  processedText = processedText.replace(
    /(^|[^\p{L}\p{N}_<])@(?!(?:\{|everyone\b|here\b))([\p{L}\p{N}_][\p{L}\p{N}_-]{0,31})/giu,
    (match, prefix, rawHandle) => {
      const handle = (rawHandle as string).trim();
      if (!handle) return match;
      const normalizedHandle = handle.toLowerCase();
      const ids = mentionMap?.get(normalizedHandle);
      if (!ids || ids.length !== 1) return `${prefix}${handle}`;
      return `${prefix}<@${ids[0]}>`;
    },
  );

  for (let i = inlineCode.length - 1; i >= 0; i--) {
    processedText = processedText.replace(`__INLINE_CODE_${i}__`, inlineCode[i]);
  }
  for (let i = codeBlocks.length - 1; i >= 0; i--) {
    processedText = processedText.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  return processedText;
}
