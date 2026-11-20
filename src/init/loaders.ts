import type { Client } from "discord.js";
import { log } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import eventHandler from "@/handlers/eventHandler";
import { isPrimaryProcess } from "@/utils/cluster/shardLeases";

// OpenRouter rates mirror into llms after capability warmup because SQL cost queries skip memory caches, and changed
// rows refresh the pre-sync LLM cache.
async function syncOpenrouterCatalogPricing(): Promise<void> {
  if (!isPrimaryProcess()) return;
  try {
    const { getAllOpenRouterPricing } = await import("@/utils/cache/openrouterCapabilityCache");
    const { llmModelRepo } = await import("@/utils/db/repositories");

    const livePricing = getAllOpenRouterPricing();
    if (livePricing.size === 0) {
      log.warn("No OpenRouter pricing available to sync (non-critical) - cost surfaces keep their stored rates");
      return;
    }

    const prices = new Map<string, { inputPerMillion: number; outputPerMillion: number }>();
    for (const [codename, pricing] of livePricing) {
      prices.set(codename, {
        inputPerMillion: pricing.promptPricePerMillion,
        outputPerMillion: pricing.completionPricePerMillion,
      });
    }

    if (!isPrimaryProcess()) return;
    const updated = await llmModelRepo.syncOpenrouterPrices(prices);
    if (updated === null) {
      log.warn("OpenRouter pricing sync failed (non-critical) - cost surfaces keep their stored rates");
      return;
    }

    if (updated > 0) {
      const { initializeLLMCache } = await import("@/utils/cache/llmCache");
      await initializeLLMCache();
    }

    log.success(`OpenRouter pricing synced: ${updated} catalog rows updated from ${livePricing.size} live rates`);
  } catch (error) {
    log.warn("Failed to sync OpenRouter pricing (non-critical)", error);
  }
}

export async function initLoaders(client: Client): Promise<void> {
  const { initializeRawModalInterception } = await import("@/utils/discord/ui/modals");
  initializeRawModalInterception(client);

  log.section("Initializing Locales...");
  await initializeLocalizer();

  log.section("Initializing Tool Registry...");
  try {
    const { initializeTools } = await import("@/tools/toolInitializer");
    await initializeTools();
    log.success("Tool registry initialized successfully");
  } catch (error) {
    log.error("Failed to initialize tool registry", error as Error);
    throw error;
  }

  log.section("Initializing LLM Configuration Cache...");
  try {
    const { initializeLLMCache } = await import("@/utils/cache/llmCache");
    await initializeLLMCache();
    log.success("LLM configuration cache initialized successfully");
  } catch (error) {
    log.warn("Failed to initialize LLM cache (non-critical)", error);
  }

  log.section("Initializing OpenRouter Capability Cache...");
  try {
    const { initializeOpenRouterCapabilityCache } = await import("@/utils/cache/openrouterCapabilityCache");
    await initializeOpenRouterCapabilityCache();
    log.success("OpenRouter capability cache initialized successfully");
  } catch (error) {
    log.warn(
      "Failed to initialize OpenRouter capability cache (non-critical) - will fall back to database flags",
      error,
    );
  }

  log.section("Syncing OpenRouter Pricing to Catalog...");
  await syncOpenrouterCatalogPricing();

  log.section("Initializing OpenRouter Modality Catalogs...");
  try {
    const [
      { initializeOpenRouterVideoModelCache },
      { initializeOpenRouterImageModelCache },
      { initializeOpenRouterEmbeddingModelCache },
    ] = await Promise.all([
      import("@/utils/cache/openrouterVideoModelCache"),
      import("@/utils/cache/openrouterImageModelCache"),
      import("@/utils/cache/openrouterEmbeddingModelCache"),
    ]);
    await Promise.all([
      initializeOpenRouterVideoModelCache(),
      initializeOpenRouterImageModelCache(),
      initializeOpenRouterEmbeddingModelCache(),
    ]);
    const { warmOpenRouterMediaPricing } = await import("@/utils/provider/openrouterMediaPricing");
    await warmOpenRouterMediaPricing();
  } catch (error) {
    log.warn("Failed to initialize OpenRouter modality catalogs (non-critical)", error);
  }

  log.section("Initializing Preset Avatar Cache...");
  try {
    const { configRepository } = await import("@/utils/db/repositories");
    const { initializePresetAvatarCache } = await import("@/utils/image/avatarHelper");

    const presets = await configRepository.loadAllPresets();
    if (presets && presets.length > 0) {
      await initializePresetAvatarCache(presets);
      log.success("Preset avatar cache initialized successfully");
    } else {
      log.warn("No presets found to cache - avatar cache will be empty (non-critical)");
    }
  } catch (error) {
    log.warn("Failed to initialize preset avatar cache (non-critical)", error);
  }

  await eventHandler(client);
}
