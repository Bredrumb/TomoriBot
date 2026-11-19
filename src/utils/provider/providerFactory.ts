import { log } from "../misc/logger";
import type { LLMProvider } from "../../types/provider/interfaces";
import type { TomoriState } from "../../types/db/schema";
import * as path from "node:path";
import { Glob } from "bun";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";

export namespace ProviderFactory {
  // Map of provider names (including aliases) to provider instances
  const providerInstances = new Map<string, LLMProvider>();

  // Map of provider names to their class constructors for lazy loading
  const providerRegistry = new Map<string, () => Promise<new () => LLMProvider>>();

  let discoveryComplete = false;

  async function discoverProviders(): Promise<void> {
    if (discoveryComplete) {
      return;
    }

    log.info("Discovering providers from src/providers/*/*Provider.ts...");

    try {
      const glob = new Glob("*/*Provider.ts");
      const providersPath = path.join(import.meta.dir, "../../providers");

      const providerEntries: Array<{ name: string; fileName: string }> = [];
      for await (const providerPath of glob.scan({
        cwd: providersPath,
      })) {
        const [providerName, fileName] = providerPath.replaceAll("\\", "/").split("/");
        if (providerName && fileName === `${providerName}Provider.ts`) {
          providerEntries.push({ name: providerName, fileName });
        }
      }

      if (providerEntries.length === 0) {
        log.warn("No provider entrypoints found in src/providers/");
        discoveryComplete = true;
        return;
      }

      log.info(
        `Found ${providerEntries.length} provider entrypoints: ${providerEntries.map(({ name }) => name).join(", ")}`,
      );

      for (const { name: providerName, fileName: providerFileName } of providerEntries) {
        try {
          // Register the provider with a lazy loader
          const importPath = `../../providers/${providerName}/${providerFileName.replace(".ts", "")}`;
          providerRegistry.set(providerName, async () => {
            const module = await import(importPath);
            const className = `${providerName.charAt(0).toUpperCase()}${providerName.slice(1)}Provider`;
            const ProviderClass = module[className];

            if (!ProviderClass) {
              throw new Error(`Provider class ${className} not found in ${importPath}`);
            }

            return ProviderClass;
          });

          log.info(`Registered provider: ${providerName}`);
        } catch (error) {
          log.error(`Error registering provider ${providerName}`, error as Error);
        }
      }

      discoveryComplete = true;
      log.success(`Provider discovery complete. Registered ${providerRegistry.size} providers.`);
    } catch (error) {
      log.error("Error during provider discovery", error as Error);
      discoveryComplete = true; // Mark as complete to avoid retry loops
    }
  }

  async function getProviderInstance(providerName: string): Promise<LLMProvider> {
    await discoverProviders();

    const normalizedName = normalizeProviderName(providerName);

    // Check if we already have an instance (check cache first for canonical and alias)
    if (providerInstances.has(normalizedName)) {
      const instance = providerInstances.get(normalizedName);
      if (instance) {
        return instance;
      }
    }

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

    // This is less efficient but handles the case where an alias is used before the provider is loaded
    for (const [registeredName, loader] of providerRegistry.entries()) {
      try {
        const ProviderClass = await loader();
        const tempInstance = new ProviderClass();
        const info = tempInstance.getInfo();

        if (info.aliases?.some((alias) => alias.toLowerCase().trim() === normalizedName)) {
          // Found a match! Cache it properly
          providerInstances.set(info.name.toLowerCase(), tempInstance);

          // Cache all aliases
          if (info.aliases) {
            for (const alias of info.aliases) {
              const aliasLower = alias.toLowerCase().trim();
              providerInstances.set(aliasLower, tempInstance);
            }
          }

          log.info(`Resolved alias "${normalizedName}" to provider "${info.name}"`);
          return tempInstance;
        }
      } catch (error) {
        log.warn(`Failed to load provider ${registeredName} while checking aliases`, {
          error: error as Error,
        });
      }
    }

    // Provider not found
    const availableProviders = Array.from(providerRegistry.keys());
    throw new Error(`Unsupported provider: ${providerName}. Available providers: ${availableProviders.join(", ")}`);
  }

  export async function getProvider(tomoriState: TomoriState): Promise<LLMProvider> {
    if (!tomoriState.llm?.llm_provider) {
      throw new Error("No LLM provider configured in TomoriState");
    }

    const providerName = normalizeProviderName(tomoriState.llm.llm_provider);
    const modelCodename = tomoriState.llm.llm_codename;

    // Get the provider instance (handles aliases automatically)
    const provider = await getProviderInstance(providerName);

    // Skip validation if supportedModels is empty (indicates provider accepts any model, e.g., OpenRouter)
    const providerInfo = provider.getInfo();
    if (
      modelCodename &&
      providerInfo.supportedModels.length > 0 &&
      !providerInfo.supportedModels.includes(modelCodename)
    ) {
      log.warn(
        `Model ${modelCodename} is not officially supported by provider ${providerName}. This may cause issues.`,
        undefined,
        {
          serverId: tomoriState.server_id,
          metadata: {
            providerName,
            modelCodename,
            supportedModels: providerInfo.supportedModels,
          },
        },
      );
    }

    log.info(`Using provider: ${providerName} with model: ${modelCodename}`);
    return provider;
  }

  export async function getProviderByName(providerName: string): Promise<LLMProvider> {
    return getProviderInstance(providerName);
  }
}

export async function getProviderForTomori(tomoriState: TomoriState): Promise<LLMProvider> {
  return ProviderFactory.getProvider(tomoriState);
}
