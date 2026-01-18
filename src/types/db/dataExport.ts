import { z } from "zod";
import { getMemoryLimits } from "@/utils/db/memoryLimits";

/**
 * Version identifier for export/import format
 * Increment when breaking changes are made to the export format
 */
export const EXPORT_VERSION = "1.0";

/**
 * Get personal data export schema with dynamic memory limits from environment
 * Validates the structure of exported personal user data
 */
export function getPersonalExportDataSchema() {
	const limits = getMemoryLimits();
	return z.object({
		user_nickname: z.string().min(1).max(100),
		language_pref: z.string().min(2).max(10),
		personal_memories: z.array(z.string()).max(limits.maxPersonalMemories),
	});
}

export type PersonalExportData = z.infer<
	ReturnType<typeof getPersonalExportDataSchema>
>;

/**
 * Get complete personal export file schema with dynamic limits
 */
export function getPersonalExportSchema() {
	return z.object({
		version: z.literal(EXPORT_VERSION),
		type: z.literal("personal"),
		exported_at: z.string(),
		data: getPersonalExportDataSchema(),
	});
}

export type PersonalExport = z.infer<ReturnType<typeof getPersonalExportSchema>>;

/**
 * Server configuration export schema
 * Excludes sensitive data (API keys) and data managed by other commands (trigger words, personality)
 */
export const serverConfigExportSchema = z.object({
	llm_temperature: z.number().min(1.0).max(2.0),
	humanizer_degree: z.number().int().min(0).max(3),
	timezone_offset: z.number().int().min(-12).max(14),
	server_memteaching_enabled: z.boolean(),
	attribute_memteaching_enabled: z.boolean(),
	sampledialogue_memteaching_enabled: z.boolean(),
	self_teaching_enabled: z.boolean(),
	web_search_enabled: z.boolean(),
	personal_memories_enabled: z.boolean(),
	emoji_usage_enabled: z.boolean(),
	sticker_usage_enabled: z.boolean(),
	imagegen_enabled: z.boolean().default(true),
});

export type ServerConfigExport = z.infer<typeof serverConfigExportSchema>;

/**
 * Get server data export schema with dynamic memory limits from environment
 * Includes configuration and server memories
 */
export function getServerExportDataSchema() {
	const limits = getMemoryLimits();
	return z.object({
		config: serverConfigExportSchema,
		server_memories: z.array(z.string()).max(limits.maxServerMemories),
	});
}

export type ServerExportData = z.infer<
	ReturnType<typeof getServerExportDataSchema>
>;

/**
 * Get complete server export file schema with dynamic limits
 */
export function getServerExportSchema() {
	return z.object({
		version: z.literal(EXPORT_VERSION),
		type: z.literal("server"),
		exported_at: z.string(),
		data: getServerExportDataSchema(),
	});
}

export type ServerExport = z.infer<ReturnType<typeof getServerExportSchema>>;

/**
 * Union type for all export formats
 */
export type DataExport = PersonalExport | ServerExport;

/**
 * Result of export operation
 */
export interface ExportResult {
	success: boolean;
	data?: DataExport;
	error?: string;
}

/**
 * Result of personality text export operation
 */
export interface PersonalityExportResult {
	success: boolean;
	text?: string;
	error?: string;
}

/**
 * Result of import operation
 */
export interface ImportResult {
	success: boolean;
	itemsImported?: {
		memoriesCount?: number;
		configFieldsCount?: number;
	};
	error?: string;
}
