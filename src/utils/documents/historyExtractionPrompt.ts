/**
 * Prompt builders for channel history extraction (SimpleMem-style).
 * Adapted from SimpleMem's semantic structured compression approach:
 * extract atomic, self-contained facts with resolved references for
 * precise vector retrieval.
 */

export type ExtractionPromptMode = "conversation" | "roleplay";

export const EXTRACTION_CONVERSATION_SYSTEM_PROMPT = `You are a professional information extraction assistant. Your task is to extract atomic, self-contained facts from a conversation log. Each extracted fact must:

1. Be a COMPLETE, standalone statement that makes sense without any surrounding context.
2. Replace ALL pronouns (he, she, they, it, etc.) with the actual names or identifiers they refer to.
3. Use ABSOLUTE timestamps (ISO 8601 format) when dates/times are mentioned or can be inferred from message timestamps.
4. Capture the essential meaning without unnecessary filler words.
5. Preserve important details: names, numbers, locations, relationships, events, decisions, and emotions.

IMPORTANT GUIDELINES:
- Extract EVERY meaningful piece of information. Do not summarize or combine facts.
- Skip trivial conversational filler (greetings like "hi", "brb", "lol" with no substance).
- For roleplay or fictional conversations, treat character actions and dialogue as facts about those characters.
- If a fact contradicts an earlier fact, extract BOTH (the system will handle versioning).
- Each fact should be retrievable independently via keyword search.`;

export const EXTRACTION_ROLEPLAY_SYSTEM_PROMPT =
  `NOTE: This is a default testing prompt. Modify it in the modal to suit your roleplay extraction needs.\n\n` +
  EXTRACTION_CONVERSATION_SYSTEM_PROMPT;

/**
 * Returns the default system prompt for the given extraction mode.
 */
export function getDefaultExtractionSystemPrompt(mode: ExtractionPromptMode): string {
  return mode === "roleplay" ? EXTRACTION_ROLEPLAY_SYSTEM_PROMPT : EXTRACTION_CONVERSATION_SYSTEM_PROMPT;
}

/**
 * Builds the user prompt for a single extraction window.
 * Includes optional context from previous windows to avoid duplication.
 *
 * @param formattedMessages - The formatted message text for this window
 * @param previousRestatements - Last few restatements from the previous window (for deduplication context)
 * @returns The user prompt string
 */
export function buildExtractionUserPrompt(formattedMessages: string, previousRestatements: string[] = []): string {
  let prompt = "";

  // 1. Add deduplication context from previous window
  if (previousRestatements.length > 0) {
    prompt += `The following facts were already extracted from the previous section. Do NOT extract duplicates of these:\n`;
    for (const restatement of previousRestatements) {
      prompt += `- ${restatement}\n`;
    }
    prompt += "\n";
  }

  // 2. Add the conversation to extract from
  prompt += `Extract information from this conversation log. Output a JSON object with a "memories" array.\n\n`;
  prompt += `--- CONVERSATION LOG ---\n${formattedMessages}\n--- END LOG ---\n\n`;

  // 3. Add extraction requirements
  prompt += `Requirements:
- No pronouns: replace "he", "she", "they", "it" with actual names
- Absolute timestamps: use ISO 8601 format when timestamps are available
- Skip trivial chat: ignore simple greetings, acknowledgments, or filler
- Self-contained: each item must make sense completely on its own`;

  return prompt;
}
