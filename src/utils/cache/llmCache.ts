/**
 * LLM Configuration Cache
 * Provides in-memory caching for LLM model configurations to eliminate database queries on every chat message
 */

import { sql } from "@/utils/db/client";
import type { LlmRow } from "../../types/db/schema";
import { log } from "../misc/logger";

/**
 * In-memory cache for LLM configurations
 * Key: llm_id, Value: LLM configuration row
 */
const llmCache = new Map<number, LlmRow>();

/**
 * Initializes the LLM configuration cache by loading all LLM models into memory
 * This should be called once at bot startup for optimal performance
 */
export async function initializeLLMCache(): Promise<void> {
	try {
		log.info("Initializing LLM configuration cache...");

		// 1. Clear existing cache
		llmCache.clear();

		// 2. Load all LLM configurations from database
		const llms = await sql`
			SELECT
				llm_id,
				llm_provider,
				llm_codename,
				is_smartest,
				is_default,
				is_reasoning,
				is_deprecated,
				is_free,
				has_tools,
				sees_images,
				sees_videos,
				sees_youtube,
				is_uncensored,
				supports_structoutput,
				llm_description,
				ja_description,
				created_at,
				updated_at
			FROM llms
			ORDER BY llm_provider, llm_codename
		`;

		if (!llms || llms.length === 0) {
			log.warn("No LLM configurations found in database");
			return;
		}

		// 3. Cache each LLM configuration
		for (const llm of llms) {
			llmCache.set(llm.llm_id, llm as LlmRow);
		}

		// 4. Log statistics
		const providerCounts = new Map<string, number>();
		for (const llm of llms) {
			const count = providerCounts.get(llm.llm_provider) || 0;
			providerCounts.set(llm.llm_provider, count + 1);
		}

		const providerStats = Array.from(providerCounts.entries())
			.map(([provider, count]) => `${provider}: ${count}`)
			.join(", ");

		log.success(
			`LLM cache initialized with ${llmCache.size} models (${providerStats})`,
		);
	} catch (error) {
		log.error("Failed to initialize LLM configuration cache:", error as Error);
		// Don't throw - bot should still work with database queries as fallback
	}
}

/**
 * Gets a cached LLM configuration by ID
 * Returns undefined if LLM is not found in cache
 * @param llmId - ID of the LLM to retrieve
 * @returns LLM configuration or undefined
 */
export function getCachedLLM(llmId: number): LlmRow | undefined {
	return llmCache.get(llmId);
}

/**
 * Gets all cached LLM configurations
 * @returns Array of all LLM configurations
 */
export function getAllCachedLLMs(): LlmRow[] {
	return Array.from(llmCache.values());
}

/**
 * Gets all cached LLM configurations for a specific provider
 * @param provider - Provider name (e.g., "google", "openai", "anthropic")
 * @returns Array of LLM configurations for the provider
 */
export function getCachedLLMsByProvider(provider: string): LlmRow[] {
	// Normalize provider name to lowercase for case-insensitive matching
	const normalizedProvider = provider.toLowerCase();
	return Array.from(llmCache.values()).filter(
		(llm) => llm.llm_provider.toLowerCase() === normalizedProvider,
	);
}

/**
 * Gets the default LLM configuration for a provider
 * @param provider - Provider name (e.g., "google", "openai", "anthropic")
 * @returns Default LLM configuration or undefined
 */
export function getCachedDefaultLLM(provider: string): LlmRow | undefined {
	// Normalize provider name to lowercase for case-insensitive matching
	const normalizedProvider = provider.toLowerCase();
	return Array.from(llmCache.values()).find(
		(llm) => llm.llm_provider.toLowerCase() === normalizedProvider && llm.is_default,
	);
}

/**
 * Gets the smartest (most capable) LLM configuration for a provider
 * @param provider - Provider name (e.g., "google", "openai", "anthropic")
 * @returns Smartest LLM configuration or undefined
 */
export function getCachedSmartestLLM(provider: string): LlmRow | undefined {
	// Normalize provider name to lowercase for case-insensitive matching
	const normalizedProvider = provider.toLowerCase();
	return Array.from(llmCache.values()).find(
		(llm) => llm.llm_provider.toLowerCase() === normalizedProvider && llm.is_smartest,
	);
}

/**
 * Gets all reasoning-capable LLM configurations for a provider
 * @param provider - Provider name (e.g., "google", "openai", "anthropic")
 * @returns Array of reasoning LLM configurations
 */
export function getCachedReasoningLLMs(provider: string): LlmRow[] {
	// Normalize provider name to lowercase for case-insensitive matching
	const normalizedProvider = provider.toLowerCase();
	return Array.from(llmCache.values()).filter(
		(llm) => llm.llm_provider.toLowerCase() === normalizedProvider && llm.is_reasoning,
	);
}

/**
 * Checks if the LLM cache is initialized and not empty
 * @returns True if cache is ready, false otherwise
 */
export function isLLMCacheReady(): boolean {
	return llmCache.size > 0;
}

/**
 * Gets the size of the LLM cache
 * @returns Number of cached LLM configurations
 */
export function getLLMCacheSize(): number {
	return llmCache.size;
}
