import { log } from "@/utils/misc/logger";

/**
 * Memory limit configuration loaded from environment variables with defaults
 */
export interface MemoryLimits {
  maxPersonalMemories: number;
  maxServerMemories: number;
  maxMemoryLength: number;
  maxSampleDialogueLength: number;
  maxAttributeLength: number;
  maxTriggerWords: number;
  maxSampleDialogues: number;
  maxAttributes: number;
  maxPersonasPerServer: number;
  maxDocumentSizeMB: number;
  maxDocumentTextLength: number;
  documentChunkSize: number;
  documentChunkOverlap: number;
  maxDocumentChunks: number;
  maxDocumentsPerServer: number;
  maxDocumentChunksPerServer: number;
}

/**
 * Result of memory limit validation
 */
export interface MemoryValidationResult {
  isValid: boolean;
  error?: MemoryValidationError;
  currentCount?: number;
  maxAllowed?: number;
}

/**
 * Types of memory validation errors
 */
export type MemoryValidationError =
  | "CONTENT_TOO_LONG"
  | "PERSONAL_MEMORY_LIMIT_EXCEEDED"
  | "SERVER_MEMORY_LIMIT_EXCEEDED"
  | "TRIGGER_WORD_LIMIT_EXCEEDED"
  | "SAMPLE_DIALOGUE_LIMIT_EXCEEDED"
  | "ATTRIBUTE_LIMIT_EXCEEDED"
  | "PERSONA_LIMIT_EXCEEDED"
  | "CONTENT_EMPTY";

/**
 * Load memory limits from environment variables with sensible defaults
 * @returns MemoryLimits configuration object
 */
export function getMemoryLimits(): MemoryLimits {
  const maxPersonalMemories = parsePositiveIntegerEnv("MAX_PERSONAL_MEMORIES", 25);
  const maxServerMemories = parsePositiveIntegerEnv("MAX_SERVER_MEMORIES", 25);
  const maxMemoryLength = parsePositiveIntegerEnv("MAX_MEMORY_LENGTH", 1000);
  const maxSampleDialogueLength = parsePositiveIntegerEnv("MAX_SAMPLE_DIALOGUE_LENGTH", 2000);
  const maxAttributeLength = parsePositiveIntegerEnv("MAX_ATTRIBUTE_LENGTH", 2000);
  const maxTriggerWords = parsePositiveIntegerEnv("MAX_TRIGGER_WORDS", 10);
  const maxSampleDialogues = parsePositiveIntegerEnv("MAX_SAMPLE_DIALOGUES", 15);
  const maxAttributes = parsePositiveIntegerEnv("MAX_ATTRIBUTES", 10);
  const maxPersonasPerServer = parsePositiveIntegerEnv("MAX_PERSONAS_PER_SERVER", 20);
  const maxDocumentSizeMB = parsePositiveIntegerEnv("MAX_DOCUMENT_SIZE_MB", 4);
  const maxDocumentTextLength = parsePositiveIntegerEnv("MAX_DOCUMENT_TEXT_LENGTH", 120000);
  const documentChunkSize = parsePositiveIntegerEnv("DOCUMENT_CHUNK_SIZE", 1000);
  const parsedDocumentChunkOverlap = parseNonNegativeIntegerEnv("DOCUMENT_CHUNK_OVERLAP", 200);
  const maxDocumentChunks = parsePositiveIntegerEnv("MAX_DOCUMENT_CHUNKS", 150);
  const maxDocumentsPerServer = parsePositiveIntegerEnv("MAX_DOCUMENTS_PER_SERVER", 20);
  const maxDocumentChunksPerServer = parsePositiveIntegerEnv("MAX_DOCUMENT_CHUNKS_PER_SERVER", 1000);

  let documentChunkOverlap = parsedDocumentChunkOverlap;
  if (documentChunkOverlap >= documentChunkSize) {
    const fallbackOverlap = Math.max(0, Math.min(200, documentChunkSize - 1));
    log.warn(
      `Invalid DOCUMENT_CHUNK_OVERLAP value: ${process.env.DOCUMENT_CHUNK_OVERLAP}. Using default: ${fallbackOverlap}`,
    );
    documentChunkOverlap = fallbackOverlap;
  }

  return {
    maxPersonalMemories,
    maxServerMemories,
    maxMemoryLength,
    maxSampleDialogueLength,
    maxAttributeLength,
    maxTriggerWords,
    maxSampleDialogues,
    maxAttributes,
    maxPersonasPerServer,
    maxDocumentSizeMB,
    maxDocumentTextLength,
    documentChunkSize,
    documentChunkOverlap,
    maxDocumentChunks,
    maxDocumentsPerServer,
    maxDocumentChunksPerServer,
  };
}

function parsePositiveIntegerEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  const parsedValue = Number.parseInt(rawValue || defaultValue.toString(), 10);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    log.warn(`Invalid ${name} value: ${rawValue}. Using default: ${defaultValue}`);
    return defaultValue;
  }

  return parsedValue;
}

function parseNonNegativeIntegerEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  const parsedValue = Number.parseInt(rawValue || defaultValue.toString(), 10);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    log.warn(`Invalid ${name} value: ${rawValue}. Using default: ${defaultValue}`);
    return defaultValue;
  }

  return parsedValue;
}

/**
 * Validate memory content length
 * @param content - The memory content to validate
 * @returns MemoryValidationResult indicating if content length is valid
 */
export function validateMemoryContent(content: string): MemoryValidationResult {
  const limits = getMemoryLimits();

  if (!content?.trim()) {
    return { isValid: false, error: "CONTENT_EMPTY" };
  }

  if (content.length > limits.maxMemoryLength) {
    return { isValid: false, error: "CONTENT_TOO_LONG", maxAllowed: limits.maxMemoryLength };
  }

  return { isValid: true };
}

/**
 * Validate attribute content length.
 * Attributes use a higher limit (default 2000) than regular memories (default 1000).
 * @param content - The attribute content to validate
 * @returns MemoryValidationResult indicating if content length is valid
 */
export function validateAttribute(content: string): MemoryValidationResult {
  const limits = getMemoryLimits();

  if (!content?.trim()) {
    return { isValid: false, error: "CONTENT_EMPTY" };
  }

  if (content.length > limits.maxAttributeLength) {
    return { isValid: false, error: "CONTENT_TOO_LONG", maxAllowed: limits.maxAttributeLength };
  }

  return { isValid: true };
}

/**
 * Validate sample dialogue content length.
 * Sample dialogues use a higher limit (default 2000) than regular memories (default 1000).
 * @param content - The sample dialogue content to validate
 * @returns MemoryValidationResult indicating if content length is valid
 */
export function validateSampleDialogue(content: string): MemoryValidationResult {
  const limits = getMemoryLimits();

  if (!content?.trim()) {
    return { isValid: false, error: "CONTENT_EMPTY" };
  }

  if (content.length > limits.maxSampleDialogueLength) {
    return { isValid: false, error: "CONTENT_TOO_LONG", maxAllowed: limits.maxSampleDialogueLength };
  }

  return { isValid: true };
}

/**
 * @deprecated Use validateAttribute() or validateSampleDialogue() instead for clearer intent
 */
export function validateAttributeAndDialogue(content: string): MemoryValidationResult {
  return validateSampleDialogue(content);
}

/**
 * Helper function to get user-friendly error message for memory validation errors
 * @param error - The memory validation error type
 * @param maxAllowed - Optional maximum allowed value for context
 * @param currentCount - Optional current count for context
 * @returns User-friendly error message
 */
export function getMemoryLimitErrorMessage(
  error: MemoryValidationError,
  maxAllowed?: number,
  currentCount?: number,
): string {
  switch (error) {
    case "CONTENT_TOO_LONG":
      return `Memory content is too long. Maximum length is ${maxAllowed} characters.`;
    case "PERSONAL_MEMORY_LIMIT_EXCEEDED":
      return `Personal memory limit reached. You can have up to ${maxAllowed} personal memories (currently: ${currentCount}).`;
    case "SERVER_MEMORY_LIMIT_EXCEEDED":
      return `Server memory limit reached. This server can have up to ${maxAllowed} memories (currently: ${currentCount}).`;
    case "TRIGGER_WORD_LIMIT_EXCEEDED":
      return `Trigger word limit reached. This server can have up to ${maxAllowed} trigger words (currently: ${currentCount}).`;
    case "SAMPLE_DIALOGUE_LIMIT_EXCEEDED":
      return `Sample dialogue limit reached. This server can have up to ${maxAllowed} sample dialogues (currently: ${currentCount}).`;
    case "ATTRIBUTE_LIMIT_EXCEEDED":
      return `Attribute limit reached. This server can have up to ${maxAllowed} attributes (currently: ${currentCount}).`;
    case "PERSONA_LIMIT_EXCEEDED":
      return `Persona limit reached. This server can have up to ${maxAllowed} personas (currently: ${currentCount}).`;
    case "CONTENT_EMPTY":
      return "Memory content cannot be empty.";
    default:
      return "Memory validation failed.";
  }
}
