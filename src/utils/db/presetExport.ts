/**
 * Preset Export Utilities
 * Handles exporting TomoriBot personality data from the database
 */

import { sql } from "@/utils/db/client";
import { log } from "../misc/logger";
import {
	PRESET_EXPORT_VERSION,
	presetExportSchema,
	type PresetExport,
	type ExportResult,
} from "../../types/preset/presetExport";

/**
 * Exports TomoriBot preset personality data for a given server
 * Queries data from both tomoris and tomori_configs tables
 * @param serverDiscId - Discord server ID to export preset for
 * @returns ExportResult containing the exported preset data or error
 */
export async function exportPresetData(
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
				error: "commands.persona.export.error_no_server_data",
			};
		}

	const serverId = serverRows[0].server_id;

		// 2. Query main persona row deterministically (most recently updated)
		const mainCountRows = await sql`
			SELECT COUNT(*)::int AS count
			FROM tomoris
			WHERE server_id = ${serverId}
			AND is_alter = false
		`;
		const mainCount = Number(mainCountRows[0]?.count ?? 0);
		if (mainCount > 1) {
			log.warn(
				`Multiple main personas found for server ${serverDiscId} (${mainCount}). Export will use the most recently updated.`,
			);
		}

		const mainRows = await sql`
			SELECT
				tomori_id,
				tomori_nickname,
				attribute_list,
				sample_dialogues_in,
				sample_dialogues_out
			FROM tomoris
			WHERE server_id = ${serverId}
			AND is_alter = false
			ORDER BY updated_at DESC NULLS LAST, tomori_id DESC
			LIMIT 1
		`;

		if (!mainRows.length) {
			return {
				success: false,
				error: "commands.persona.export.error_no_preset_data",
			};
		}

		const presetData = mainRows[0];

		// 3. Load trigger words from server-scoped config (fallback to legacy tomori_id config)
		let triggerWords: string[] | null = null;
		const configRows = await sql`
			SELECT trigger_words
			FROM tomori_configs
			WHERE server_id = ${serverId}
			ORDER BY updated_at DESC NULLS LAST, tomori_config_id DESC
			LIMIT 1
		`;

		if (configRows.length) {
			triggerWords = configRows[0].trigger_words ?? null;
		} else if (presetData.tomori_id) {
			const legacyRows = await sql`
				SELECT trigger_words
				FROM tomori_configs
				WHERE tomori_id = ${presetData.tomori_id}
				ORDER BY updated_at DESC NULLS LAST, tomori_config_id DESC
				LIMIT 1
			`;
			if (legacyRows.length) {
				triggerWords = legacyRows[0].trigger_words ?? null;
			}
		}

		// 4. Build export object with metadata
		const exportData: PresetExport = {
			version: PRESET_EXPORT_VERSION,
			type: "preset",
			exported_at: new Date().toISOString(),
			data: {
				tomori_nickname: presetData.tomori_nickname,
				attribute_list: presetData.attribute_list || [],
				sample_dialogues_in: presetData.sample_dialogues_in || [],
				sample_dialogues_out: presetData.sample_dialogues_out || [],
				trigger_words: triggerWords || [],
			},
		};

		// 5. Validate export data structure
		const validated = presetExportSchema.safeParse(exportData);
		if (!validated.success) {
			log.error(
				`Preset export validation failed for server ${serverDiscId}:`,
				validated.error,
			);
			return {
				success: false,
				error: "commands.persona.export.error_validation_failed",
			};
		}

		log.success(
			`Successfully exported preset for server ${serverDiscId}: ${presetData.tomori_nickname}`,
		);

		return {
			success: true,
			data: validated.data,
		};
	} catch (error) {
		log.error(`Error exporting preset data for server ${serverDiscId}:`, error);
		return {
			success: false,
			error: "commands.persona.export.error_export_failed",
		};
	}
}
