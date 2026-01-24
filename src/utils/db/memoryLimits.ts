import { sql } from "@/utils/db/client";
import { log } from "../misc/logger";

/**
 * Absolute maximum limits for preset data validation
 * These represent the highest configurable values and serve as the single source of truth
 * Used by both runtime validation and Zod schema validation for preset export/import
 *
 * These values match the upper bounds in the validation checks within getMemoryLimits()
 */
export const ABSOLUTE_MAX_STRING_LENGTH = 5000; // Max length for attributes and sample dialogues (line 139, 159)
export const ABSOLUTE_MAX_ATTRIBUTES = 200; // Max number of attributes (line 219)
export const ABSOLUTE_MAX_SAMPLE_DIALOGUES = 100; // Max number of sample dialogue pairs (line 199)
export const ABSOLUTE_MAX_TRIGGER_WORDS = 100; // Max number of trigger words (line 179)
export const ABSOLUTE_MAX_PERSONAS_PER_SERVER = 200; // Max number of personas per server

/**
 * Memory limit configuration loaded from environment variables with defaults
 */
export interface MemoryLimits {
	maxPersonalMemories: number;
	maxServerMemories: number;
	maxMemoryLength: number;
	maxSampleDialogueLength: number; // Separate limit for sample dialogues (longer than regular memories)
	maxAttributeLength: number; // Separate limit for attribute descriptions (detailed personality info)
	maxTriggerWords: number;
	maxSampleDialogues: number;
	maxAttributes: number;
	maxPersonasPerServer: number;
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
	const maxPersonalMemories = Number.parseInt(
		process.env.MAX_PERSONAL_MEMORIES || "25",
		10,
	);
	const maxServerMemories = Number.parseInt(
		process.env.MAX_SERVER_MEMORIES || "25",
		10,
	);
	const maxMemoryLength = Number.parseInt(
		process.env.MAX_MEMORY_LENGTH || "256",
		10,
	);
	const maxSampleDialogueLength = Number.parseInt(
		process.env.MAX_SAMPLE_DIALOGUE_LENGTH || "2000",
		10,
	);
	const maxAttributeLength = Number.parseInt(
		process.env.MAX_ATTRIBUTE_LENGTH || "2000",
		10,
	);
	const maxTriggerWords = Number.parseInt(
		process.env.MAX_TRIGGER_WORDS || "10",
		10,
	);
	const maxSampleDialogues = Number.parseInt(
		process.env.MAX_SAMPLE_DIALOGUES || "10",
		10,
	);
	const maxAttributes = Number.parseInt(process.env.MAX_ATTRIBUTES || "10", 10);
	const maxPersonasPerServer = Number.parseInt(
		process.env.MAX_PERSONAS_PER_SERVER || "20",
		10,
	);

	// Validate that environment variables are reasonable numbers
	if (
		!Number.isInteger(maxPersonalMemories) ||
		maxPersonalMemories <= 0 ||
		maxPersonalMemories > 1000
	) {
		log.warn(
			`Invalid MAX_PERSONAL_MEMORIES value: ${process.env.MAX_PERSONAL_MEMORIES}. Using default: 30`,
		);
		return {
			maxPersonalMemories: 30,
			maxServerMemories,
			maxMemoryLength,
			maxSampleDialogueLength,
			maxAttributeLength,
			maxTriggerWords,
			maxSampleDialogues,
			maxAttributes,
			maxPersonasPerServer,
		};
	}

	if (
		!Number.isInteger(maxServerMemories) ||
		maxServerMemories <= 0 ||
		maxServerMemories > 1000
	) {
		log.warn(
			`Invalid MAX_SERVER_MEMORIES value: ${process.env.MAX_SERVER_MEMORIES}. Using default: 50`,
		);
		return {
			maxPersonalMemories,
			maxServerMemories: 50,
			maxMemoryLength,
			maxSampleDialogueLength,
			maxAttributeLength,
			maxTriggerWords,
			maxSampleDialogues,
			maxAttributes,
			maxPersonasPerServer,
		};
	}

	if (
		!Number.isInteger(maxMemoryLength) ||
		maxMemoryLength <= 0 ||
		maxMemoryLength > 2000
	) {
		log.warn(
			`Invalid MAX_MEMORY_LENGTH value: ${process.env.MAX_MEMORY_LENGTH}. Using default: 500`,
		);
		return {
			maxPersonalMemories,
			maxServerMemories,
			maxMemoryLength: 500,
			maxSampleDialogueLength,
			maxAttributeLength,
			maxTriggerWords,
			maxSampleDialogues,
			maxAttributes,
			maxPersonasPerServer,
		};
	}

	if (
		!Number.isInteger(maxSampleDialogueLength) ||
		maxSampleDialogueLength <= 0 ||
		maxSampleDialogueLength > 5000
	) {
		log.warn(
			`Invalid MAX_SAMPLE_DIALOGUE_LENGTH value: ${process.env.MAX_SAMPLE_DIALOGUE_LENGTH}. Using default: 2000`,
		);
		return {
			maxPersonalMemories,
			maxServerMemories,
			maxMemoryLength,
			maxSampleDialogueLength: 2000,
			maxAttributeLength,
			maxTriggerWords,
			maxSampleDialogues,
			maxAttributes,
			maxPersonasPerServer,
		};
	}

	if (
		!Number.isInteger(maxAttributeLength) ||
		maxAttributeLength <= 0 ||
		maxAttributeLength > 5000
	) {
		log.warn(
			`Invalid MAX_ATTRIBUTE_LENGTH value: ${process.env.MAX_ATTRIBUTE_LENGTH}. Using default: 2000`,
		);
		return {
			maxPersonalMemories,
			maxServerMemories,
			maxMemoryLength,
			maxSampleDialogueLength,
			maxAttributeLength: 2000,
			maxTriggerWords,
			maxSampleDialogues,
			maxAttributes,
			maxPersonasPerServer,
		};
	}

	if (
		!Number.isInteger(maxTriggerWords) ||
		maxTriggerWords <= 0 ||
		maxTriggerWords > 100
	) {
		log.warn(
			`Invalid MAX_TRIGGER_WORDS value: ${process.env.MAX_TRIGGER_WORDS}. Using default: 10`,
		);
		return {
			maxPersonalMemories,
			maxServerMemories,
			maxMemoryLength,
			maxSampleDialogueLength,
			maxAttributeLength,
			maxTriggerWords: 10,
			maxSampleDialogues,
			maxAttributes,
			maxPersonasPerServer,
		};
	}

	if (
		!Number.isInteger(maxSampleDialogues) ||
		maxSampleDialogues <= 0 ||
		maxSampleDialogues > 100
	) {
		log.warn(
			`Invalid MAX_SAMPLE_DIALOGUES value: ${process.env.MAX_SAMPLE_DIALOGUES}. Using default: 10`,
		);
		return {
			maxPersonalMemories,
			maxServerMemories,
			maxMemoryLength,
			maxSampleDialogueLength,
			maxAttributeLength,
			maxTriggerWords,
			maxSampleDialogues: 10,
			maxAttributes,
			maxPersonasPerServer,
		};
	}

	if (
		!Number.isInteger(maxAttributes) ||
		maxAttributes <= 0 ||
		maxAttributes > 200
	) {
		log.warn(
			`Invalid MAX_ATTRIBUTES value: ${process.env.MAX_ATTRIBUTES}. Using default: 10`,
		);
		return {
			maxPersonalMemories,
			maxServerMemories,
			maxMemoryLength,
			maxSampleDialogueLength,
			maxAttributeLength,
			maxTriggerWords,
			maxSampleDialogues,
			maxAttributes: 10,
			maxPersonasPerServer,
		};
	}

	if (
		!Number.isInteger(maxPersonasPerServer) ||
		maxPersonasPerServer <= 0 ||
		maxPersonasPerServer > ABSOLUTE_MAX_PERSONAS_PER_SERVER
	) {
		log.warn(
			`Invalid MAX_PERSONAS_PER_SERVER value: ${process.env.MAX_PERSONAS_PER_SERVER}. Using default: 20`,
		);
		return {
			maxPersonalMemories,
			maxServerMemories,
			maxMemoryLength,
			maxSampleDialogueLength,
			maxAttributeLength,
			maxTriggerWords,
			maxSampleDialogues,
			maxAttributes,
			maxPersonasPerServer: 20,
		};
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
	};
}

/**
 * Validate memory content length
 * @param content - The memory content to validate
 * @returns MemoryValidationResult indicating if content length is valid
 */
export function validateMemoryContent(content: string): MemoryValidationResult {
	const limits = getMemoryLimits();

	// Check if content is empty or just whitespace
	if (!content || !content.trim()) {
		return {
			isValid: false,
			error: "CONTENT_EMPTY",
		};
	}

	// Check if content exceeds maximum length
	if (content.length > limits.maxMemoryLength) {
		return {
			isValid: false,
			error: "CONTENT_TOO_LONG",
			maxAllowed: limits.maxMemoryLength,
		};
	}

	return { isValid: true };
}

/**
 * Validate attribute content length
 * Attributes use a higher limit (default 2000) than regular memories (default 256)
 * This is because attributes contain detailed 2-3 paragraph personality descriptions
 * @param content - The attribute content to validate
 * @returns MemoryValidationResult indicating if content length is valid
 */
export function validateAttribute(content: string): MemoryValidationResult {
	const limits = getMemoryLimits();

	// Check if content is empty or just whitespace
	if (!content || !content.trim()) {
		return {
			isValid: false,
			error: "CONTENT_EMPTY",
		};
	}

	// Check if content exceeds maximum length for attributes
	if (content.length > limits.maxAttributeLength) {
		return {
			isValid: false,
			error: "CONTENT_TOO_LONG",
			maxAllowed: limits.maxAttributeLength,
		};
	}

	return { isValid: true };
}

/**
 * Validate sample dialogue content length
 * Sample dialogues use a higher limit (default 2000) than regular memories (default 256)
 * This is because sample dialogues need more context for meaningful conversations
 * @param content - The sample dialogue content to validate
 * @returns MemoryValidationResult indicating if content length is valid
 */
export function validateSampleDialogue(
	content: string,
): MemoryValidationResult {
	const limits = getMemoryLimits();

	// Check if content is empty or just whitespace
	if (!content || !content.trim()) {
		return {
			isValid: false,
			error: "CONTENT_EMPTY",
		};
	}

	// Check if content exceeds maximum length for sample dialogues
	if (content.length > limits.maxSampleDialogueLength) {
		return {
			isValid: false,
			error: "CONTENT_TOO_LONG",
			maxAllowed: limits.maxSampleDialogueLength,
		};
	}

	return { isValid: true };
}

/**
 * @deprecated Use validateAttribute() or validateSampleDialogue() instead for clearer intent
 * Validate attribute and sample dialogue content length
 * Both attributes and sample dialogues use a higher limit (default 2000) than regular memories (default 256)
 * @param content - The attribute or sample dialogue content to validate
 * @returns MemoryValidationResult indicating if content length is valid
 */
export function validateAttributeAndDialogue(
	content: string,
): MemoryValidationResult {
	// Delegates to validateSampleDialogue for backward compatibility
	// (uses the same limit as before)
	return validateSampleDialogue(content);
}

/**
 * Check if a user has reached their personal memory limit
 * @param userId - Internal user ID (not Discord ID)
 * @returns MemoryValidationResult indicating if user can add more memories
 */
export async function checkPersonalMemoryLimit(
	userId: number,
): Promise<MemoryValidationResult> {
	const limits = getMemoryLimits();

	try {
		// Get current count of personal memories for this user
		const [userRow] = await sql`
			SELECT array_length(personal_memories, 1) as memory_count
			FROM users
			WHERE user_id = ${userId}
		`;

		// Handle case where user has no memories yet (array_length returns null for empty arrays)
		const currentCount = userRow?.memory_count || 0;

		if (currentCount >= limits.maxPersonalMemories) {
			return {
				isValid: false,
				error: "PERSONAL_MEMORY_LIMIT_EXCEEDED",
				currentCount,
				maxAllowed: limits.maxPersonalMemories,
			};
		}

		return {
			isValid: true,
			currentCount,
			maxAllowed: limits.maxPersonalMemories,
		};
	} catch (error) {
		log.error(
			`Error checking personal memory limit for user ${userId}:`,
			error,
		);
		// Fail safe - if we can't check the limit, assume it's exceeded
		return {
			isValid: false,
			error: "PERSONAL_MEMORY_LIMIT_EXCEEDED",
		};
	}
}

/**
 * Check if a server has reached its memory limit
 * @param serverId - Internal server ID (not Discord ID)
 * @returns MemoryValidationResult indicating if server can add more memories
 */
export async function checkServerMemoryLimit(
	serverId: number,
): Promise<MemoryValidationResult> {
	const limits = getMemoryLimits();

	try {
		// Get current count of server memories for this server
		const [countResult] = await sql`
			SELECT COUNT(*) as memory_count
			FROM server_memories
			WHERE server_id = ${serverId}
		`;

		const currentCount = Number(countResult?.memory_count || 0);

		if (currentCount >= limits.maxServerMemories) {
			return {
				isValid: false,
				error: "SERVER_MEMORY_LIMIT_EXCEEDED",
				currentCount,
				maxAllowed: limits.maxServerMemories,
			};
		}

		return {
			isValid: true,
			currentCount,
			maxAllowed: limits.maxServerMemories,
		};
	} catch (error) {
		log.error(
			`Error checking server memory limit for server ${serverId}:`,
			error,
		);
		// Fail safe - if we can't check the limit, assume it's exceeded
		return {
			isValid: false,
			error: "SERVER_MEMORY_LIMIT_EXCEEDED",
		};
	}
}

/**
 * Check if a server has reached its trigger word limit
 * @param serverId - Internal server ID
 * @returns MemoryValidationResult indicating if server can add more trigger words
 */
export async function checkTriggerWordLimit(
	serverId: number,
): Promise<MemoryValidationResult> {
	const limits = getMemoryLimits();

	try {
		// Get current count of trigger words for this server
		const [configResult] = await sql`
			SELECT array_length(trigger_words, 1) as trigger_count
			FROM tomori_configs
			WHERE server_id = ${serverId}
		`;

		// Handle case where server has no trigger words yet (array_length returns null for empty arrays)
		const currentCount = configResult?.trigger_count || 0;

		if (currentCount >= limits.maxTriggerWords) {
			return {
				isValid: false,
				error: "TRIGGER_WORD_LIMIT_EXCEEDED",
				currentCount,
				maxAllowed: limits.maxTriggerWords,
			};
		}

		return {
			isValid: true,
			currentCount,
			maxAllowed: limits.maxTriggerWords,
		};
	} catch (error) {
		log.error(
			`Error checking trigger word limit for server ${serverId}:`,
			error,
		);
		// Fail safe - if we can't check the limit, assume it's exceeded
		return {
			isValid: false,
			error: "TRIGGER_WORD_LIMIT_EXCEEDED",
		};
	}
}

/**
 * Check if a server has reached its sample dialogue limit
 * @param tomoriId - Internal tomori ID
 * @returns MemoryValidationResult indicating if server can add more sample dialogues
 */
export async function checkSampleDialogueLimit(
	tomoriId: number,
): Promise<MemoryValidationResult> {
	const limits = getMemoryLimits();

	try {
		// Get current count of sample dialogues for this server
		const [tomoriResult] = await sql`
			SELECT 
				array_length(sample_dialogues_in, 1) as dialogue_count
			FROM tomoris
			WHERE tomori_id = ${tomoriId}
		`;

		// Handle case where server has no sample dialogues yet (array_length returns null for empty arrays)
		const currentCount = tomoriResult?.dialogue_count || 0;

		if (currentCount >= limits.maxSampleDialogues) {
			return {
				isValid: false,
				error: "SAMPLE_DIALOGUE_LIMIT_EXCEEDED",
				currentCount,
				maxAllowed: limits.maxSampleDialogues,
			};
		}

		return {
			isValid: true,
			currentCount,
			maxAllowed: limits.maxSampleDialogues,
		};
	} catch (error) {
		log.error(
			`Error checking sample dialogue limit for tomori ${tomoriId}:`,
			error,
		);
		// Fail safe - if we can't check the limit, assume it's exceeded
		return {
			isValid: false,
			error: "SAMPLE_DIALOGUE_LIMIT_EXCEEDED",
		};
	}
}

/**
 * Check if a server has reached its attribute limit
 * @param tomoriId - Internal tomori ID
 * @returns MemoryValidationResult indicating if server can add more attributes
 */
export async function checkAttributeLimit(
	tomoriId: number,
): Promise<MemoryValidationResult> {
	const limits = getMemoryLimits();

	try {
		// Get current count of attributes for this server
		const [tomoriResult] = await sql`
			SELECT array_length(attribute_list, 1) as attribute_count
			FROM tomoris
			WHERE tomori_id = ${tomoriId}
		`;

		// Handle case where server has no attributes yet (array_length returns null for empty arrays)
		const currentCount = tomoriResult?.attribute_count || 0;

		if (currentCount >= limits.maxAttributes) {
			return {
				isValid: false,
				error: "ATTRIBUTE_LIMIT_EXCEEDED",
				currentCount,
				maxAllowed: limits.maxAttributes,
			};
		}

		return {
			isValid: true,
			currentCount,
			maxAllowed: limits.maxAttributes,
		};
	} catch (error) {
		log.error(`Error checking attribute limit for tomori ${tomoriId}:`, error);
		// Fail safe - if we can't check the limit, assume it's exceeded
		return {
			isValid: false,
			error: "ATTRIBUTE_LIMIT_EXCEEDED",
		};
	}
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
