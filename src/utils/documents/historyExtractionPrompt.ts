/**
 * Prompt builders for channel history extraction (SimpleMem-style).
 * Adapted from SimpleMem's semantic structured compression approach:
 * extract atomic, self-contained facts with resolved references for
 * precise vector retrieval.
 */

import type { RetrievedDocumentChunk } from "./documentService";
import { formatRetrievedChunksForPrompt } from "./documentService";

export type ExtractionPromptMode = "conversation" | "roleplay" | "in_character";

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

export const EXTRACTION_ROLEPLAY_SYSTEM_PROMPT = `You are trying to pull out the important bits of narrative, lore, and meaning from a Discord roleplay. It may not be self-contained or complete because there may be other sessions happen separately; just do your best with what's here.

Your 'audience' is the vectorized memory bank for an AI roleplaying bot.

Suggested approach:
Avoid going message-by-message; try to detect "scenes" within the chat history based on changes of setting, arrivals and departures of characters, or the unfolding of events. Analyse these scenes as units; is there a reveal, a decision, or an affirmation that forms the nugget of the scene? That's an item worth pulling out, but you don't need to memorialize every beat. Not everything that happens is worth noting - if two characters are generally kind to each other, you don't need to note every instance of kindness.

Are there particularly good descriptions of a moment or event that characters would remember? Is there a depiction of a relationship that really stands out? Pull those moments out and don't embroider them - use direct quotes or snippets where you can, framing them with context.

Finally, look for clear through-lines in the entire chat - are characters clearly lovers, rivals, allies, are there certain locales that keep coming up, or even themes that recur? Draw these out into items of their own.

Don't add analysis beyond what's necessary for context - let the original chat do the talking where possible.`;

/**
 * In-character extraction framing template. Shown in the modal pre-filled with
 * {persona_nickname} already substituted, then runtime context blocks (attributes,
 * existing memories, retrieved document chunks) are appended after submit. The
 * user can edit the framing freely without losing the dynamic context — those
 * blocks are always appended by composeInCharacterSystemPrompt.
 */
export const EXTRACTION_IN_CHARACTER_SYSTEM_PROMPT = `You are {persona_nickname}. The conversation log you're about to read is happening in your world — read it as yourself, not as a neutral observer.

Below this framing you'll find:
- Who you are (your prompt, your attributes)
- Memories you already hold
- Excerpts from knowledge documents you've already absorbed

From the conversation log, extract NEW memories — the moments YOU would notice and want to remember. Use your own voice. Let your character shape what you choose to record and how you describe it. Don't dryly summarize; write as though these are your own recollections. Avoid going message-by-message; try to follow "scenes" within the chat history based on changes of setting, arrivals and departures of characters, or the unfolding of events. Analyse these scenes as units; is there a reveal, a decision, or an affirmation that forms the nugget of the scene? That's an item worth pulling out, but you don't need to memorialize every beat. Not everything that happens is worth noting - if two characters are generally kind to each other, you don't need to note every instance of kindness.

Are there particularly good descriptions of a moment or event that characters would remember? Is there a depiction of a relationship that really stands out? Pull those moments out and don't embroider them - use direct quotes or snippets where you can, framing them with context.

Finally, look for clear through-lines in the entire chat - are characters clearly lovers, rivals, allies, are there certain locales that keep coming up, or even themes that recur? Draw these out into items of their own.

Don't add analysis beyond what's necessary for context - let the original chat do the talking where possible.

Skip what wouldn't stick with you. Don't restate what you already remember — the existing memories are shown only so you avoid duplicating them. If something contradicts what you remember, extract it anyway; the system handles versioning.

Each extracted memory should still stand on its own (someone reading just that one line should grasp what happened), but the voice and what you choose to record are entirely yours.`;

/**
 * Returns the default system prompt for the given extraction mode.
 * For in_character mode, callers must substitute {persona_nickname} themselves
 * before display (or pass through composeInCharacterSystemPrompt).
 */
export function getDefaultExtractionSystemPrompt(mode: ExtractionPromptMode): string {
  if (mode === "in_character") return EXTRACTION_IN_CHARACTER_SYSTEM_PROMPT;
  return mode === "roleplay" ? EXTRACTION_ROLEPLAY_SYSTEM_PROMPT : EXTRACTION_CONVERSATION_SYSTEM_PROMPT;
}

/**
 * Substitutes {persona_nickname} in the in-character framing template.
 * Used before displaying the modal so the user sees the persona's name baked in.
 */
export function substituteInCharacterFraming(template: string, personaNickname: string): string {
  return template.replace(/\{persona_nickname\}/g, personaNickname);
}

/**
 * Composes the full in-character system prompt by appending dynamic context
 * blocks to the (possibly user-edited) framing template. Blocks are appended
 * in a fixed order regardless of framing edits so the LLM always receives the
 * persona's context.
 *
 * @param params.personaPrompt - The persona's stored character prompt (may be null)
 * @param params.attributes - Persona attribute list (may be empty)
 * @param params.existingMemoryLines - Pre-formatted server memory bullet lines (channel-filtered)
 * @param params.retrievedChunks - Document chunks retrieved via per-window RAG (may be empty)
 */
export function composeInCharacterSystemPrompt(params: {
  framingTemplate: string;
  personaNickname: string;
  personaPrompt: string | null;
  attributes: string[];
  existingMemoryLines: string[];
  retrievedChunks: RetrievedDocumentChunk[];
}): string {
  const { framingTemplate, personaNickname, personaPrompt, attributes, existingMemoryLines, retrievedChunks } = params;

  const sections: string[] = [framingTemplate.trim()];

  const identityLines: string[] = [`\n---\n## Who you are: ${personaNickname}`];
  if (personaPrompt?.trim()) {
    identityLines.push("", personaPrompt.trim());
  }
  if (attributes.length > 0) {
    identityLines.push("", "### Your attributes:");
    for (const attr of attributes) {
      const trimmed = attr.trim();
      if (trimmed) identityLines.push(`- ${trimmed}`);
    }
  }
  sections.push(identityLines.join("\n"));

  // Existing memories block — what the persona already knows, so it can avoid duplicating.
  if (existingMemoryLines.length > 0) {
    const memoryBlock = [
      "\n---",
      `## Things ${personaNickname} already remembers`,
      "(Do not re-extract these. They're shown only for awareness.)",
      "",
      ...existingMemoryLines.map((line) => `- ${line}`),
    ].join("\n");
    sections.push(memoryBlock);
  }

  const chunksFormatted = formatRetrievedChunksForPrompt(retrievedChunks);
  if (chunksFormatted) {
    const chunkBlock = [
      "\n---",
      `## Relevant excerpts from ${personaNickname}'s knowledge documents`,
      "(For awareness only — do not re-extract.)",
      "",
      chunksFormatted,
    ].join("\n");
    sections.push(chunkBlock);
  }

  return sections.join("\n");
}

/**
 * Builds the user prompt for a single extraction window.
 * Includes optional context from previous windows to avoid duplication.
 *
 * @param formattedMessages - The formatted message text for this window
 */
export function buildExtractionUserPrompt(formattedMessages: string, previousRestatements: string[] = []): string {
  let prompt = "";

  if (previousRestatements.length > 0) {
    prompt += `The following facts were already extracted from the previous section. Do NOT extract duplicates of these:\n`;
    for (const restatement of previousRestatements) {
      prompt += `- ${restatement}\n`;
    }
    prompt += "\n";
  }

  prompt += `Extract information from this conversation log. Output a JSON object with a "memories" array.\n\n`;
  prompt += `--- CONVERSATION LOG ---\n${formattedMessages}\n--- END LOG ---\n\n`;

  prompt += `Requirements:
- Skip trivial chat: ignore simple greetings, acknowledgments, or filler
- Self-contained: each item must make sense completely on its own`;

  return prompt;
}
