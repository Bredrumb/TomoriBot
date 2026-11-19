import { log } from "../misc/logger";
import type { LLMProvider } from "../../types/provider/interfaces";
import type { TomoriState } from "../../types/db/schema";
import * as path from "node:path";
import { Glob } from "bun";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";

export namespace ProviderFactory {
  const providerInstances = new Map<string, LLMProvider>();

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
      // Mark complete on failure so failed scans do not loop on every lookup.
      discoveryComplete = true;
    }
  }

  async function getProviderInstance(providerName: string): Promise<LLMProvider> {
    await discoverProviders();

    const normalizedName = normalizeProviderName(providerName);

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

      providerInstances.set(normalizedName, provider);

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

    // Aliases are only discovered after loading the provider class, so scan unloaded providers as a fallback.
    for (const [registeredName, loader] of providerRegistry.entries()) {
      try {
        const ProviderClass = await loader();
        const tempInstance = new ProviderClass();
        const info = tempInstance.getInfo();

        if (info.aliases?.some((alias) => alias.toLowerCase().trim() === normalizedName)) {
          providerInstances.set(info.name.toLowerCase(), tempInstance);

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

    const availableProviders = Array.from(providerRegistry.keys());
    throw new Error(`Unsupported provider: ${providerName}. Available providers: ${availableProviders.join(", ")}`);
  }

  export async function getProvider(tomoriState: TomoriState): Promise<LLMProvider> {
    if (!tomoriState.llm?.llm_provider) {
      throw new Error("No LLM provider configured in TomoriState");
    }

    const providerName = normalizeProviderName(tomoriState.llm.llm_provider);
    const modelCodename = tomoriState.llm.llm_codename;

    const provider = await getProviderInstance(providerName);

    // Empty supportedModels means the provider accepts arbitrary model IDs (such as OpenRouter).
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
