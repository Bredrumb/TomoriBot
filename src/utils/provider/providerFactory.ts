/**
 * Provider Factory for creating LLM provider instances
 * This factory implements auto-discovery of providers from src/providers/* directories
 * and provides a clean interface for getting the appropriate provider.
 */

import { log } from "../misc/logger";
import type {
	LLMProvider,
	ProviderInfo,
} from "../../types/provider/interfaces";
import type { TomoriState } from "../../types/db/schema";
import * as path from "node:path";
import { Glob } from "bun";

/**
 * Provider factory namespace for creating LLM provider instances
 */
export namespace ProviderFactory {
	// Map of provider names (including aliases) to provider instances
	const providerInstances = new Map<string, LLMProvider>();

	// Map of provider names to their class constructors for lazy loading
	const providerRegistry = new Map<
		string,
		() => Promise<new () => LLMProvider>
	>();

	// Flag to track if discovery has been run
	let discoveryComplete = false;

	/**
	 * Discover all available providers by scanning src/providers/* directories
	 * This function is called lazily on first access to any provider
	 */
	async function discoverProviders(): Promise<void> {
		if (discoveryComplete) {
			return;
		}

		log.info("Discovering providers from src/providers/*...");

		try {
			// 1. Scan for provider directories using Bun.glob
			const glob = new Glob("*/");
			const providersPath = path.join(import.meta.dir, "../../providers");

			const providerDirs: string[] = [];
			for await (const dir of glob.scan({
				cwd: providersPath,
				onlyFiles: false,
			})) {
				providerDirs.push(dir);
			}

			if (providerDirs.length === 0) {
				log.warn("No provider directories found in src/providers/");
				discoveryComplete = true;
				return;
			}

			log.info(
				`Found ${providerDirs.length} provider directories: ${providerDirs.join(", ")}`,
			);

			// 2. For each directory, check if it has a provider implementation file
			for (const dir of providerDirs) {
				const providerName = dir.replace(/\/$/, ""); // Remove trailing slash
				const providerFileName = `${providerName}Provider.ts`;
				const providerPath = path.join(providersPath, dir, providerFileName);

				try {
					// 3. Check if the provider file exists
					const file = Bun.file(providerPath);
					const exists = await file.exists();

					if (!exists) {
						log.warn(`Skipping ${providerName}: No ${providerFileName} found`);
						continue;
					}

					// 4. Register the provider with a lazy loader
					const importPath = `../../providers/${providerName}/${providerFileName.replace(".ts", "")}`;
					providerRegistry.set(providerName, async () => {
						const module = await import(importPath);
						const className = `${providerName.charAt(0).toUpperCase()}${providerName.slice(1)}Provider`;
						const ProviderClass = module[className];

						if (!ProviderClass) {
							throw new Error(
								`Provider class ${className} not found in ${importPath}`,
							);
						}

						return ProviderClass;
					});

					log.info(`Registered provider: ${providerName}`);
				} catch (error) {
					log.error(
						`Error registering provider ${providerName}`,
						error as Error,
					);
				}
			}

			discoveryComplete = true;
			log.success(
				`Provider discovery complete. Registered ${providerRegistry.size} providers.`,
			);
		} catch (error) {
			log.error("Error during provider discovery", error as Error);
			discoveryComplete = true; // Mark as complete to avoid retry loops
		}
	}

	/**
	 * Get a provider instance by name (canonical name or alias)
	 * Uses singleton pattern to reuse provider instances
	 * @param providerName - The name or alias of the provider (e.g., "google", "gemini")
	 * @returns The provider instance
	 * @throws Error if provider is not supported
	 */
	async function getProviderInstance(
		providerName: string,
	): Promise<LLMProvider> {
		// Ensure discovery has run
		await discoverProviders();

		const normalizedName = providerName.toLowerCase().trim();

		// 1. Check if we already have an instance (check cache first for canonical and alias)
		if (providerInstances.has(normalizedName)) {
			const instance = providerInstances.get(normalizedName);
			if (instance) {
				return instance;
			}
		}

		// 2. Check if this is a registered canonical provider name
		if (providerRegistry.has(normalizedName)) {
			const ProviderClassLoader = providerRegistry.get(normalizedName);
			if (!ProviderClassLoader) {
				throw new Error(`Provider loader not found for: ${normalizedName}`);
			}

			const ProviderClass = await ProviderClassLoader();
			const provider = new ProviderClass();

			// Cache the instance under canonical name
			providerInstances.set(normalizedName, provider);

			// Also cache under all aliases
			const info = provider.getInfo();
			if (info.aliases) {
				for (const alias of info.aliases) {
					const aliasLower = alias.toLowerCase().trim();
					providerInstances.set(aliasLower, provider);
					log.info(`Registered alias "${alias}" for provider "${info.name}"`);
				}
			}

			log.info(`Created new provider instance: ${normalizedName}`);
			return provider;
		}

		// 3. Check if this might be an alias - try loading all providers to check aliases
		// This is less efficient but handles the case where an alias is used before the provider is loaded
		for (const [registeredName, loader] of providerRegistry.entries()) {
			try {
				const ProviderClass = await loader();
				const tempInstance = new ProviderClass();
				const info = tempInstance.getInfo();

				// Check if the normalized name matches any alias
				if (
					info.aliases?.some(
						(alias) => alias.toLowerCase().trim() === normalizedName,
					)
				) {
					// Found a match! Cache it properly
					providerInstances.set(info.name.toLowerCase(), tempInstance);

					// Cache all aliases
					if (info.aliases) {
						for (const alias of info.aliases) {
							const aliasLower = alias.toLowerCase().trim();
							providerInstances.set(aliasLower, tempInstance);
						}
					}

					log.info(
						`Resolved alias "${normalizedName}" to provider "${info.name}"`,
					);
					return tempInstance;
				}
			} catch (error) {
				log.warn(
					`Failed to load provider ${registeredName} while checking aliases`,
					{
						error: error as Error,
					},
				);
			}
		}

		// 4. Provider not found
		const availableProviders = Array.from(providerRegistry.keys());
		throw new Error(
			`Unsupported provider: ${providerName}. Available providers: ${availableProviders.join(", ")}`,
		);
	}

	/**
	 * Get a provider based on the TomoriState configuration
	 * @param tomoriState - The Tomori state containing LLM provider information
	 * @returns The appropriate provider instance
	 * @throws Error if provider is not supported or not configured
	 */
	export async function getProvider(
		tomoriState: TomoriState,
	): Promise<LLMProvider> {
		if (!tomoriState.llm?.llm_provider) {
			throw new Error("No LLM provider configured in TomoriState");
		}

		const providerName = tomoriState.llm.llm_provider.toLowerCase().trim();
		const modelCodename = tomoriState.llm.llm_codename;

		// Get the provider instance (handles aliases automatically)
		const provider = await getProviderInstance(providerName);

		// Validate that the configured model is supported by the provider
		if (
			modelCodename &&
			!provider.getInfo().supportedModels.includes(modelCodename)
		) {
			log.warn(
				`Model ${modelCodename} is not officially supported by provider ${providerName}. This may cause issues.`,
				{
					serverId: tomoriState.server_id,
					metadata: {
						providerName,
						modelCodename,
						supportedModels: provider.getInfo().supportedModels,
					},
				},
			);
		}

		log.info(`Using provider: ${providerName} with model: ${modelCodename}`);
		return provider;
	}

	/**
	 * Get all available providers and their information
	 * @returns Array of provider information objects
	 */
	export async function getAvailableProviders(): Promise<
		Array<{ name: string; info: ProviderInfo }>
	> {
		// Ensure discovery has run
		await discoverProviders();

		const availableProviders: Array<{ name: string; info: ProviderInfo }> = [];

		// Try to load each registered provider
		for (const providerName of providerRegistry.keys()) {
			try {
				const provider = await getProviderInstance(providerName);
				availableProviders.push({
					name: providerName,
					info: provider.getInfo(),
				});
			} catch (error) {
				log.warn(
					`Provider ${providerName} not available: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		return availableProviders;
	}

	/**
	 * Check if a provider type is supported (including aliases)
	 * @param providerName - The provider name to check
	 * @returns True if the provider is supported
	 */
	export async function isProviderSupported(
		providerName: string,
	): Promise<boolean> {
		// Ensure discovery has run
		await discoverProviders();

		const normalizedName = providerName.toLowerCase().trim();

		// Check if it's a canonical name
		if (providerRegistry.has(normalizedName)) {
			return true;
		}

		// Check if it's an alias by trying to load all providers
		for (const [registeredName] of providerRegistry.entries()) {
			try {
				const provider = await getProviderInstance(registeredName);
				const info = provider.getInfo();

				if (
					info.aliases?.some(
						(alias) => alias.toLowerCase().trim() === normalizedName,
					)
				) {
					return true;
				}
			} catch (_error) {}
		}

		return false;
	}

	/**
	 * Clear all cached provider instances (useful for testing or reloading)
	 */
	export function clearCache(): void {
		providerInstances.clear();
		log.info("Cleared provider instance cache");
	}

	/**
	 * Reset discovery state (useful for testing)
	 */
	export function resetDiscovery(): void {
		providerRegistry.clear();
		providerInstances.clear();
		discoveryComplete = false;
		log.info("Reset provider discovery state");
	}
}

/**
 * Convenience function to get a provider from TomoriState
 * @param tomoriState - The Tomori state
 * @returns The appropriate provider instance
 */
export async function getProviderForTomori(
	tomoriState: TomoriState,
): Promise<LLMProvider> {
	return ProviderFactory.getProvider(tomoriState);
}
