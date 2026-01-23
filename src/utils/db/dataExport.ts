import { sql } from "@/utils/db/client";
import { log } from "../misc/logger";
import {
	EXPORT_VERSION,
	getPersonalExportSchema,
	getServerExportSchema,
	type PersonalExport,
	type ServerExport,
	type ExportResult,
	type PersonalityExportResult,
} from "../../types/db/dataExport";

/**
 * Sanitizes a string for safe JSON serialization
 * Removes control characters (except newlines and tabs) that could break JSON
 * @param content - The content to sanitize
 * @returns Object with sanitized content and flag indicating if sanitization occurred
 */
function sanitizeForJson(content: string): {
	sanitized: string;
	wasSanitized: boolean;
} {
	// 1. Remove null bytes and control characters except \n (0x0A) and \t (0x09)
	// Regex matches control chars (0x00-0x1F) except newline and tab
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control characters for sanitization
	const cleaned = content.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, "");

	// 2. Check if sanitization occurred
	const wasSanitized = cleaned !== content;

	return { sanitized: cleaned, wasSanitized };
}

/**
 * Sanitizes an array of memory strings for safe JSON export
 * @param memories - Array of memory strings to sanitize
 * @param contextLabel - Label for logging (e.g., "personal memories", "server memories")
 * @returns Object with sanitized memories and count of sanitized items
 */
function sanitizeMemories(
	memories: string[],
	contextLabel: string,
): { sanitized: string[]; sanitizedCount: number } {
	// 1. Track how many memories were sanitized
	let sanitizedCount = 0;

	// 2. Sanitize each memory string
	const sanitized = memories.map((memory, index) => {
		const { sanitized: cleanMemory, wasSanitized } = sanitizeForJson(memory);

		// 3. Log warning if sanitization occurred
		if (wasSanitized) {
			sanitizedCount++;
			log.warn(
				`Sanitized ${contextLabel} at index ${index}: removed control characters`,
			);
		}

		return cleanMemory;
	});

	return { sanitized, sanitizedCount };
}

/**
 * Exports personal user data (nickname, language preference, memories)
 * @param userDiscId - Discord user ID to export data for
 * @returns ExportResult containing the exported data or error
 */
export async function exportPersonalData(
	userDiscId: string,
): Promise<ExportResult> {
	try {
		// 1. Query user data from database
		const rows = await sql`
			SELECT user_nickname, language_pref, personal_memories
			FROM users
			WHERE user_disc_id = ${userDiscId}
			LIMIT 1
		`;

		if (!rows.length) {
			return {
				success: false,
				error: "commands.data.export.error_no_user_data",
			};
		}

		const userData = rows[0];

		// 2. Sanitize memories for safe JSON export
		const { sanitized: sanitizedMemories } = sanitizeMemories(
			userData.personal_memories || [],
			"personal memories",
		);

		// 3. Build export object
		const exportData: PersonalExport = {
			version: EXPORT_VERSION,
			type: "personal",
			exported_at: new Date().toISOString(),
			data: {
				user_nickname: userData.user_nickname,
				language_pref: userData.language_pref,
				personal_memories: sanitizedMemories,
			},
		};

		// 4. Validate export data structure
		const validated = getPersonalExportSchema().safeParse(exportData);
		if (!validated.success) {
			log.error(
				`Personal export validation failed for user ${userDiscId}:`,
				validated.error,
			);
			return {
				success: false,
				error: "commands.data.export.error_validation_failed",
			};
		}

		return {
			success: true,
			data: validated.data,
		};
	} catch (error) {
		log.error(`Error exporting personal data for user ${userDiscId}:`, error);
		return {
			success: false,
			error: "commands.data.export.error_export_failed",
		};
	}
}

/**
 * Exports server data (configuration and server memories)
 * @param serverDiscId - Discord server ID to export data for
 * @returns ExportResult containing the exported data or error
 */
export async function exportServerData(
	serverDiscId: string,
): Promise<ExportResult> {
	try {
		// 1. Get internal server ID
		const serverRows = await sql`
			SELECT server_id
			FROM servers
			WHERE server_disc_id = ${serverDiscId}
			LIMIT 1
		`;

		if (!serverRows.length) {
			return {
				success: false,
				error: "commands.data.export.error_no_server_data",
			};
		}

		const serverId = serverRows[0].server_id;

		// 2. Get tomori configuration
		const configRows = await sql`
			SELECT
				COALESCE(tc_server.llm_temperature, tc_legacy.llm_temperature) as llm_temperature,
				COALESCE(tc_server.humanizer_degree, tc_legacy.humanizer_degree) as humanizer_degree,
				COALESCE(tc_server.timezone_offset, tc_legacy.timezone_offset) as timezone_offset,
				COALESCE(tc_server.server_memteaching_enabled, tc_legacy.server_memteaching_enabled) as server_memteaching_enabled,
				COALESCE(tc_server.attribute_memteaching_enabled, tc_legacy.attribute_memteaching_enabled) as attribute_memteaching_enabled,
				COALESCE(tc_server.sampledialogue_memteaching_enabled, tc_legacy.sampledialogue_memteaching_enabled) as sampledialogue_memteaching_enabled,
				COALESCE(tc_server.self_teaching_enabled, tc_legacy.self_teaching_enabled) as self_teaching_enabled,
				COALESCE(tc_server.web_search_enabled, tc_legacy.web_search_enabled) as web_search_enabled,
				COALESCE(tc_server.personal_memories_enabled, tc_legacy.personal_memories_enabled) as personal_memories_enabled,
				COALESCE(tc_server.emoji_usage_enabled, tc_legacy.emoji_usage_enabled) as emoji_usage_enabled,
				COALESCE(tc_server.sticker_usage_enabled, tc_legacy.sticker_usage_enabled) as sticker_usage_enabled,
				COALESCE(tc_server.imagegen_enabled, tc_legacy.imagegen_enabled) as imagegen_enabled
			FROM tomoris t
			LEFT JOIN tomori_configs tc_server ON tc_server.server_id = t.server_id
			LEFT JOIN tomori_configs tc_legacy ON tc_legacy.tomori_id = t.tomori_id
			WHERE t.server_id = ${serverId}
			AND t.is_alter = false
			LIMIT 1
		`;

		if (!configRows.length) {
			return {
				success: false,
				error: "commands.data.export.error_no_server_config",
			};
		}

		const configData = configRows[0];

		// 3. Get server memories
		const memoryRows = await sql`
			SELECT content
			FROM server_memories
			WHERE server_id = ${serverId}
			ORDER BY created_at DESC
		`;

		const serverMemories = memoryRows.map(
			(row: { content: string }) => row.content,
		);

		// 4. Sanitize memories for safe JSON export
		const { sanitized: sanitizedServerMemories } = sanitizeMemories(
			serverMemories,
			"server memories",
		);

		// 5. Build export object
		const exportData: ServerExport = {
			version: EXPORT_VERSION,
			type: "server",
			exported_at: new Date().toISOString(),
			data: {
				config: {
					llm_temperature: configData.llm_temperature,
					humanizer_degree: configData.humanizer_degree,
					timezone_offset: configData.timezone_offset,
					server_memteaching_enabled: configData.server_memteaching_enabled,
					attribute_memteaching_enabled:
						configData.attribute_memteaching_enabled,
					sampledialogue_memteaching_enabled:
						configData.sampledialogue_memteaching_enabled,
					self_teaching_enabled: configData.self_teaching_enabled,
					web_search_enabled: configData.web_search_enabled,
					personal_memories_enabled: configData.personal_memories_enabled,
					emoji_usage_enabled: configData.emoji_usage_enabled,
					sticker_usage_enabled: configData.sticker_usage_enabled,
					imagegen_enabled: configData.imagegen_enabled,
				},
				server_memories: sanitizedServerMemories,
			},
		};

		// 6. Validate export data structure
		const validated = getServerExportSchema().safeParse(exportData);
		if (!validated.success) {
			log.error(
				`Server export validation failed for server ${serverDiscId}:`,
				validated.error,
			);
			return {
				success: false,
				error: "commands.data.export.error_validation_failed",
			};
		}

		return {
			success: true,
			data: validated.data,
		};
	} catch (error) {
		log.error(`Error exporting server data for server ${serverDiscId}:`, error);
		return {
			success: false,
			error: "commands.data.export.error_export_failed",
		};
	}
}

/**
 * Exports personality data as a human-readable text file
 * @param serverDiscId - Discord server ID to export personality for
 * @returns PersonalityExportResult containing formatted text or error
 */
export async function exportPersonalityData(
	serverDiscId: string,
): Promise<PersonalityExportResult> {
	try {
		// 1. Get internal server ID and personality data
		const rows = await sql`
			SELECT
				t.tomori_nickname,
				t.attribute_list,
				t.sample_dialogues_in,
				t.sample_dialogues_out
			FROM tomoris t
			JOIN servers s ON t.server_id = s.server_id
			WHERE s.server_disc_id = ${serverDiscId}
			AND t.is_alter = false
			LIMIT 1
		`;

		if (!rows.length) {
			return {
				success: false,
				error: "commands.data.export.error_no_personality_data",
			};
		}

		const personalityData = rows[0];

		// 2. Format personality data as human-readable text
		let textOutput = "";

		// Add header with personality name
		textOutput += `========================================\n`;
		textOutput += `TOMORI PERSONALITY EXPORT\n`;
		textOutput += `========================================\n\n`;
		textOutput += `Personality Name: ${personalityData.tomori_nickname}\n`;
		textOutput += `Exported: ${new Date().toISOString()}\n\n`;

		// Add attributes section
		textOutput += `========================================\n`;
		textOutput += `ATTRIBUTES\n`;
		textOutput += `========================================\n\n`;

		const attributes = personalityData.attribute_list || [];
		if (attributes.length > 0) {
			attributes.forEach((attr: string, index: number) => {
				textOutput += `${index + 1}. ${attr}\n`;
			});
		} else {
			textOutput += `No attributes defined.\n`;
		}

		textOutput += `\n`;

		// Add sample dialogues section
		textOutput += `========================================\n`;
		textOutput += `SAMPLE DIALOGUES\n`;
		textOutput += `========================================\n\n`;

		const dialoguesIn = personalityData.sample_dialogues_in || [];
		const dialoguesOut = personalityData.sample_dialogues_out || [];

		if (dialoguesIn.length > 0 && dialoguesOut.length > 0) {
			const maxLength = Math.max(dialoguesIn.length, dialoguesOut.length);

			for (let i = 0; i < maxLength; i++) {
				textOutput += `--- Dialogue ${i + 1} ---\n`;
				textOutput += `User: ${dialoguesIn[i] || "(none)"}\n`;
				textOutput += `Tomori: ${dialoguesOut[i] || "(none)"}\n\n`;
			}
		} else {
			textOutput += `No sample dialogues defined.\n\n`;
		}

		// Add footer note
		textOutput += `========================================\n`;
		textOutput += `NOTE\n`;
		textOutput += `========================================\n\n`;
		textOutput += `This export is for informational purposes only.\n`;
		textOutput += `To import personalities, use the /persona commands.\n`;

		return {
			success: true,
			text: textOutput,
		};
	} catch (error) {
		log.error(
			`Error exporting personality data for server ${serverDiscId}:`,
			error,
		);
		return {
			success: false,
			error: "commands.data.export.error_export_failed",
		};
	}
}
